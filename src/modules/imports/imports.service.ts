import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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

  // 来源 -> 账户命名前缀/类型：自动创建账户时使用
  private readonly SOURCE_ACCOUNT: Record<string, { prefix: string; type: string }> = {
    alipay: { prefix: '支付宝', type: 'alipay' },
    wechat: { prefix: '微信', type: 'wechat' },
    ccb_saving: { prefix: '建行活期', type: 'bank' },
    ccb_credit: { prefix: '建行信用卡', type: 'credit' },
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
      skips?: { rowNo: number; reason: string }[]; // 解析阶段跳过的明细（重复单号/状态无效等）
      bills: (NormalizedBill & { categoryId?: bigint; note?: string })[];
    },
  ) {
    const { source, fileName, bills, accountId, groupId, skips } = payload;

    let success = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { rowNo: number; reason: string; raw?: any }[] = [];

    // 已存在的 externalId 集合（去重，按平台标识）
    const existingIds = await this.getExistingExternalIds(userId, source, bills.map((b) => b.externalId));

    // 系统分类查询（懒加载缓存）
    const categoryCache = new Map<string, bigint>();
    const categories = await this.prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] } });
    for (const c of categories) {
      const key = `${c.type}:${c.name}`;
      categoryCache.set(key, c.id);
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
        continue;
      }
      if (!b.amountCents || b.amountCents === 0n) {
        failed++;
        failures.push({ rowNo, reason: '金额无效' });
        continue;
      }

      // 分类解析：优先用户指定 categoryId，否则按来源映射 sourceCategory
      let categoryId = b.categoryId;
      if (!categoryId) {
        const mapped = this.mapCategory(source, b.sourceCategory, b.billType);
        if (mapped) {
          const cacheKey = `${b.billType}:${mapped}`;
          categoryId = categoryCache.get(cacheKey);
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
        extraJson: b.extraJson || undefined,
        neutral: b.neutral,
        rawData: b.rawData ? { data: b.rawData } : undefined,
        billDate: this.normalizeTime(b.time),
      });
    }

    if (createMany.length > 0) {
      await this.prisma.bill.createMany({ data: createMany });
    }
    success = createMany.length;

    const batch = await this.prisma.importBatch.create({
      data: {
        userId,
        source,
        fileName,
        groupId: groupId || null,
        total: bills.length,
        success,
        skipped,
        failed,
        status: 'done',
      },
    });

    // 失败明细（kind=fail）与解析阶段跳过明细（kind=skip）统一入库，供详情查看
    const detailRows: { batchId: bigint; kind: string; rowNo: number; reason: string; raw?: any }[] = failures.map(
      (f) => ({ batchId: batch.id, kind: 'fail', rowNo: f.rowNo, reason: f.reason, raw: f.raw ? { data: f.raw } : undefined }),
    );
    for (const s of skips || []) {
      detailRows.push({ batchId: batch.id, kind: 'skip', rowNo: s.rowNo, reason: s.reason });
    }
    if (detailRows.length > 0) {
      await this.prisma.importFailure.createMany({ data: detailRows });
    }

    return { batchId: batch.id, total: bills.length, success, skipped, failed };
  }

  // 导入时按平台文件输出的个人账户信息自动创建/匹配账户。
// 唯一性：以 (userId, name) 唯一索引为准，同名账户一律复用，不重复创建。
private async ensureAccount(userId: bigint, source: string, info: string): Promise<bigint | null> {
    const cfg = this.SOURCE_ACCOUNT[source];
    const name = cfg && info ? `${cfg.prefix}-${info.trim()}` : '';
    if (!name || name.length > 50) return null;
    const account = await this.prisma.account.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name, type: cfg!.type },
    });
    return account.id;
  }

  async batches(userId: bigint) {
    const batches = await this.prisma.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
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

  // 按来源分别映射：支付宝用交易分类，微信用交易类型
  protected mapCategory(source: string, sourceCategory: string | undefined, billType: string): string | undefined {
    if (!sourceCategory) return undefined;
    if (billType === 'neutral') return undefined;
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