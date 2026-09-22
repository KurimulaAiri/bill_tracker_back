import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NormalizedBill } from './types/normalized-bill';

// 支付宝交易分类 -> 系统分类 映射表
const ALIPAY_CATEGORY_MAP: Record<string, string> = {
  餐饮美食: '餐饮美食',
  交通出行: '交通出行',
  日用百货: '日用百货',
  文化休闲: '文化休闲',
  充值缴费: '居住缴费',
  投资理财: '投资理财',
  资金互转: '资金互转',
  退款: '退款收入',
  医疗健康: '医疗健康',
  其他: '其他支出',
};

// 微信"交易类型" -> 系统分类 映射表
const WECHAT_CATEGORY_MAP: Record<string, string> = {
  商户消费: '其他支出',
  亲属卡消费: '其他支出',
  转账: '资金互转',
  群收款: '其他收入',
  二维码收款: '其他收入',
  个人收款: '其他收入',
  红包: '资金互转',
  退款: '退款收入',
  零钱提现: '资金互转',
  零钱充值: '资金互转',
  银行卡转入: '资金互转',
  游戏充值: '文化休闲',
  手机充值: '居住缴费',
  信用卡还款: '其他支出',
  理财通赎回: '投资理财',
  理财通购买: '投资理财',
};

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  // 来源 -> 账户父节点/子账户类型配置：微信/支付宝归其自身，建行统一归「建设银行」
  private readonly SOURCE_ACCOUNT: Record<string, { parentName: string; parentType: string; childType: string; childPrefix?: string }> = {
    alipay: { parentName: '支付宝', parentType: 'alipay', childType: 'alipay' },
    wechat: { parentName: '微信', parentType: 'wechat', childType: 'wechat' },
    ccb_saving: { parentName: '建设银行', parentType: 'bank', childType: 'bank', childPrefix: '储蓄卡' },
    ccb_credit: { parentName: '建设银行', parentType: 'bank', childType: 'credit', childPrefix: '信用卡' },
  };

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // 预览确认后入库
  async confirmImport(
    userId: bigint,
    payload: {
      source: string;
      fileName: string;
      accountId?: bigint;
      groupId?: string; // 批量导入会话ID：同一次批量导入的多文件共用
      skips?: { rowNo: number; reason: string; raw?: unknown }[]; // 解析阶段跳过的明细（重复单号/状态无效等），raw 为导致跳过的原始值
      meta?: Record<string, unknown>; // 文件头元信息（昵称/时间范围/表尾汇总等），随批次保存
      bills: (NormalizedBill & { categoryId?: bigint; note?: string })[];
    },
  ) {
    const { source, fileName, bills, accountId, groupId, skips, meta } = payload;
    const skipList = Array.isArray(skips) ? skips : [];

    // 跳过/失败计数与明细统一：解析阶段跳过直接计入 skipped 并有明细（kind=skip）
    let success = 0;
    let skipped = skipList.length;
    let failed = 0;
    const failures: { rowNo: number; reason: string; raw?: any }[] = [];
    const skipDetails: { rowNo: number; reason: string; raw?: any }[] = skipList.map((s) => ({
      rowNo: s.rowNo,
      reason: s.reason,
      raw: s.raw,
    }));

    // 已存在的 externalId 集合（去重，按平台标识）
    const existingIds = await this.getExistingExternalIds(userId, source, bills.map((b) => b.externalId));

    // 系统分类查询（懒加载缓存）
    const categoryCache = new Map<string, bigint>();
    const categories = await this.prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] } });
    for (const c of categories) {
      const key = `${c.type}:${c.name}`;
      categoryCache.set(key, c.id);
    }
    // 用户自定义源分类映射：(source|sourceCategory) -> 分类（含收支类型，用于校验）
    const aliasMap = new Map<string, { id: bigint; type: string }>();
    for (const c of categories) {
      const aliases = (c as any).aliases;
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          if (a && a.source && a.value) aliasMap.set(`${a.source}|${a.value}`, { id: c.id, type: c.type });
        }
      }
    }

    // 批次内按平台标识去重（同文件重复行、前端重复提交等）
    const seenInBatch = new Set<string>();
    const deduped: { b: (NormalizedBill & { categoryId?: bigint; note?: string }); rowNo: number }[] = [];
    bills.forEach((b, i) => {
      const dedupKey = b.externalId
        ? `${source}:${b.externalId}`
        : `${source}:na:${this.toDateStr(b.time)}:${b.amountCents.toString()}:${b.remark || ''}`;
      if (seenInBatch.has(dedupKey)) {
        skipped++;
        skipDetails.push({ rowNo: i + 1, reason: '重复记录，跳过' });
        return;
      }
      seenInBatch.add(dedupKey);
      deduped.push({ b, rowNo: i + 1 });
    });

    const createMany: any[] = [];
    // 自动账户缓存：账户信息 -> AccountId（同批次同一账户只查建一次）
    const accountCache = new Map<string, bigint | null>();
    for (const { b, rowNo } of deduped) {
      if (!b.externalId || existingIds.has(b.externalId)) {
        skipped++;
        skipDetails.push({ rowNo, reason: b.externalId ? '交易单号已存在，跳过' : '缺少交易单号，跳过', raw: b.rawData });
        continue;
      }
      if (!b.amountCents || b.amountCents === 0n) {
        failed++;
        failures.push({ rowNo, reason: '金额无效', raw: b.rawData });
        continue;
      }

      // 分类解析：1) 用户指定 categoryId 2) 用户自定义映射（分类管理页配置的 aliases，优先于内置表）
      let categoryId = b.categoryId;
      if (!categoryId) {
        const aliasHit = b.sourceCategory ? aliasMap.get(`${source}|${b.sourceCategory}`) : undefined;
        if (aliasHit && aliasHit.type === b.billType) {
          categoryId = aliasHit.id;
        } else {
          const mapped = this.mapCategory(source, b.sourceCategory, b.billType);
          const cacheKey = mapped && `${b.billType}:${mapped}`;
          categoryId = cacheKey ? categoryCache.get(cacheKey) : undefined;
          // 兜底：映射出的分类在该收支类型下不存在时（如微信红包/转账映射的"资金互转"仅为支出类型），
          // 回退"其他收入/其他支出"，保证导入记录都有分类
          if (!categoryId) {
            const fallback = b.billType === 'income' ? '其他收入' : '其他支出';
            categoryId = categoryCache.get(`${b.billType}:${fallback}`);
          }
        }
      }

      // 账户归属：手动指定 accountId 则全部使用之；否则按每笔的账户信息自动创建/匹配
      let billAccountId: bigint | null = null;
      if (accountId) {
        billAccountId = accountId;
      } else {
        const info = b.accountHint || b.cardNo || '';
        if (info) {
          if (!accountCache.has(info)) {
            accountCache.set(info, await this.ensureAccount(userId, source, info));
          }
          billAccountId = accountCache.get(info) ?? null;
        }
      }

      // 叠加优惠标注：支付方式含 &（如 花呗&碰一下立减）时，账户归并到主方式，
      // & 后的优惠/减免方式拆出并存到 extraJson，便于详情查看
      const extraJson = { ...(b.extraJson || {}) };
      if (b.accountHint && String(b.accountHint).includes('&')) {
        const perks = String(b.accountHint)
          .split('&')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(1);
        if (perks.length) extraJson['优惠/减免'] = perks.join('、');
      }

      createMany.push({
        userId,
        accountId: billAccountId,
        categoryId: categoryId || null,
        amount: b.amountCents,
        billType: b.billType,
        note: b.remark || null,
        source,
        externalId: b.externalId,
        counterParty: b.counterParty || null,
        counterpartyAccount: b.counterpartyAccount || null,
        merchantNo: b.merchantNo || null,
        payMethod: b.payMethod || null,
        cardNo: b.cardNo || null,
        status: b.status || null,
        extraJson: Object.keys(extraJson).length ? extraJson : undefined,
        neutral: b.neutral,
        rawData: b.rawData ? { data: b.rawData } : undefined,
        billDate: this.normalizeTime(b.time),
      });
    }

    // 批次组：同一次批量导入（groupId 相同）幂等复用同一组记录
    let importGroupId: bigint | null = null;
    if (groupId) {
      const g = await this.prisma.importGroup.upsert({
        where: { userId_groupKey: { userId, groupKey: groupId } },
        update: {},
        create: { userId, groupKey: groupId },
      });
      importGroupId = g.id;
    }

    // 先建批次获取批次ID，账单写入批次快照（importBatchId + batchFileName），满足"明细可溯源到批次/文件"
    const batch = await this.prisma.importBatch.create({
      data: {
        userId,
        source,
        fileName,
        groupId: groupId || null,
        importGroupId,
        total: bills.length + skipList.length,
        success: 0,
        skipped,
        failed,
        meta: meta && Object.keys(meta).length ? (meta as Prisma.InputJsonValue) : undefined,
        status: 'done',
      },
    });

    if (createMany.length > 0) {
      await this.prisma.bill.createMany({
        data: createMany.map((b) => ({
          ...b,
          importBatchId: batch.id,
          importGroupId,
          batchFileName: fileName,
        })),
      });
    }
    success = createMany.length;

    // 失败明细（kind=fail）与跳过明细（kind=skip）统一入库，供详情查看；raw 存导致问题/跳过的原始字段值
    const detailRows: { batchId: bigint; kind: string; rowNo: number; reason: string; raw?: any }[] = [
      ...skipDetails.map((s) => ({ batchId: batch.id, kind: 'skip', rowNo: s.rowNo, reason: s.reason, raw: s.raw ? { data: s.raw } : undefined })),
      ...failures.map((f) => ({ batchId: batch.id, kind: 'fail', rowNo: f.rowNo, reason: f.reason, raw: f.raw ? { data: f.raw } : undefined })),
    ];
    if (detailRows.length > 0) {
      await this.prisma.importFailure.createMany({ data: detailRows });
    }

    return { batchId: batch.id, total: bills.length + skipList.length, success, skipped, failed };
  }

  // 导入时按平台文件输出的个人账户信息自动创建/匹配父+子账户。
// 结构：微信/支付宝（父）-> 支付方式子账户；建设银行（父）-> 储蓄卡/信用卡-卡号后四位子账户
private async ensureAccount(userId: bigint, source: string, info: string): Promise<bigint | null> {
    const cfg = this.SOURCE_ACCOUNT[source];
    if (!cfg) return null;
    const parent = await this.ensureParentAccount(userId, cfg.parentName, cfg.parentType);
    const childName = this.normalizeChildName(cfg, info);
    // 支付方式为空（微信/支付宝）：直接挂到父账户本身
    if (childName === null) return parent.id;
    if (childName.length > 50) return null;
    const child = await this.prisma.account.upsert({
      where: { userId_parentId_name: { userId, parentId: parent.id, name: childName } },
      update: {},
      create: { userId, parentId: parent.id, name: childName, type: cfg.childType },
    });
    return child.id;
  }

  // 确保父账户存在（findFirst 不存在则创建），按 (userId, parentId=null, name) 唯一兜底
  private async ensureParentAccount(userId: bigint, name: string, type: string) {
    const parent = await this.prisma.account.findFirst({
      where: { userId, parentId: null, name, type },
    });
    if (parent) return parent;
    return this.prisma.account.create({ data: { userId, name, type } });
  }

  // 子账户命名：微信/支付宝取主支付方式（如 零钱、花呗；含 & 取主支付方式；空/占位符返回 null 归父账户本身）。
  // 建行（childPrefix 储蓄卡/信用卡）取卡号后四位生成 `储蓄卡-1234`/`信用卡-1234`；卡号为空(或无误)时用默认类型名。
  protected normalizeChildName(cfg: { childPrefix?: string }, info: string): string | null {
    const main = String(info || '').trim().split('&')[0].trim();
    const isEmpty = !main || /^[-/]+$/.test(main) || main === '无';
    if (cfg.childPrefix) {
      if (isEmpty) return cfg.childPrefix;
      const last4 = main.replace(/\D/g, '').slice(-4);
      return last4 ? `${cfg.childPrefix}-${last4}` : cfg.childPrefix;
    }
    if (isEmpty) return null;
    return main;
  }

  async batches(userId: bigint) {
    const batches = await this.prisma.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return batches;
  }

  async batchDetail(userId: bigint, batchId: bigint) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw new BadRequestException('批次不存在');
    const failures = await this.prisma.importFailure.findMany({ where: { batchId } });
    return { batch, failures };
  }

  /**
   * 手动去重：按用户维度清理重复账单。
   * 1) 有 externalId（平台标识）：同 userId+source+externalId 保留最早一条，删除其余
   * 2) 无 externalId：按 时间+金额+类型+备注 内容指纹，同指纹保留最早一条
   * 返回 { removed, groups }
   */
  async dedupe(userId: bigint) {
    const all = await this.prisma.bill.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        source: true,
        externalId: true,
        amount: true,
        billType: true,
        note: true,
        billDate: true,
      },
    });

    const keepIds = new Set<bigint>();
    const removeIds = new Set<bigint>();
    const groups: { key: string; count: number }[] = [];

    // 1) externalId 分组（平台标识）
    const byExt = new Map<string, typeof all>();
    for (const b of all) {
      if (b.externalId) {
        const k = `${b.userId}|${b.source}|${b.externalId}`;
        if (!byExt.has(k)) byExt.set(k, []);
        byExt.get(k)!.push(b);
      }
    }
    for (const [key, list] of byExt) {
      if (list.length > 1) {
        const [keep, ...dups] = list;
        keepIds.add(keep.id);
        for (const d of dups) removeIds.add(d.id);
        groups.push({ key, count: list.length });
      }
    }

    // 2) 无 externalId 内容指纹分组
    const byFp = new Map<string, typeof all>();
    for (const b of all) {
      if (!b.externalId) {
        const k = `${b.userId}|${b.source}|${b.amount.toString()}|${b.billType}|${b.note || ''}|${this.toDateStr(b.billDate)}`;
        if (!byFp.has(k)) byFp.set(k, []);
        byFp.get(k)!.push(b);
      }
    }
    for (const [key, list] of byFp) {
      if (list.length > 1) {
        const [keep, ...dups] = list;
        keepIds.add(keep.id);
        for (const d of dups) removeIds.add(d.id);
        groups.push({ key, count: list.length });
      }
    }

    const removed = removeIds.size;
    if (removed > 0) {
      const ids = [...removeIds];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await this.prisma.bill.deleteMany({ where: { userId, id: { in: chunk } } });
      }
    }

    this.logger.log(`手动去重完成: 删除 ${removed} 条, 共 ${groups.length} 组`);
    return { removed, groups: groups.slice(0, 50) };
  }

  // 按来源分别映射：支付宝用交易分类，微信用交易类型；本地导出回导分类列已是系统分类名，直配
  protected mapCategory(source: string, sourceCategory: string | undefined, billType: string): string | undefined {
    if (!sourceCategory) return undefined;
    if (billType === 'neutral') return undefined;
    if (source === 'export') return sourceCategory;
    const table = source === 'wechat' ? WECHAT_CATEGORY_MAP : ALIPAY_CATEGORY_MAP;
    const mapped = table[sourceCategory];
    if (mapped) return mapped === '退款收入' && billType === 'expense' ? '其他支出' : mapped;
    // 未匹配的类别归"其他"
    return billType === 'income' ? '其他收入' : '其他支出';
  }

  protected async getExistingExternalIds(userId: bigint, source: string, externalIds: (string | undefined)[]): Promise<Set<string>> {
    const ids = externalIds.filter((x): x is string => !!x);
    if (ids.length === 0) return new Set();
    const found = await this.prisma.bill.findMany({
      where: { userId, source, externalId: { in: ids } },
      select: { externalId: true },
    });
    return new Set(found.map((f) => f.externalId as string));
  }

  protected normalizeTime(t: Date | string): Date {
    if (t instanceof Date) return t;
    const d = new Date(t);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  protected toDateStr(t: Date | string): string {
    const d = this.normalizeTime(t);
    return d.toISOString().replace(/[:.]/g, '').slice(0, 14);
  }
}