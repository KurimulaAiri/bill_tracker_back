import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ParserRegistry } from '../../imports/parsers/parser.registry';
import { NormalizedBill } from './types/normalized-bill';
import { ParseResult } from './types/parse-result';

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

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parserRegistry: ParserRegistry,
  ) {}

  // 上传解析（不入库），返回预览数据
  async parseUpload(userId: bigint, file: Express.Multer.File): Promise<{ parse: ParseResult; hints: { accountHint?: string; unknownCategories: string[] } }> {
    const parser = this.parserRegistry.find(file.originalname);
    if (!parser) {
      throw new BadRequestException(`暂不支持该文件格式: ${file.originalname}（支持支付宝csv/微信xlsx/建行活期xls/建行信用卡pdf）`);
    }
    const parse = await parser.parse(file.path);
    // 收集未知分类提示
    const unknown = new Set<string>();
    for (const b of parse.bills) {
      if (b.sourceCategory) {
        const mapped = this.mapCategory(b.sourceCategory, b.billType);
        if (!mapped) unknown.add(b.sourceCategory);
      }
    }
    return { parse, hints: { accountHint: parse.accountHint, unknownCategories: [...unknown] } };
  }

  // 预览确认后入库
  async confirmImport(
    userId: bigint,
    payload: {
      source: string;
      fileName: string;
      accountId?: bigint;
      bills: (NormalizedBill & { categoryId?: bigint; note?: string })[];
    },
  ) {
    const { source, fileName, bills, accountId } = payload;

    let success = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { rowNo: number; reason: string; raw?: any }[] = [];

    // 已存在的 externalId 集合（去重）
    const existingIds = await this.getExistingExternalIds(userId, source, bills.map((b) => b.externalId));

    // 系统分类查询（懒加载缓存）
    const categoryCache = new Map<string, bigint>();
    const categories = await this.prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] } });
    for (const c of categories) {
      const key = `${c.type}:${c.name}`;
      categoryCache.set(key, c.id);
    }

    const createMany: any[] = [];
    bills.forEach((b, i) => {
      const rowNo = i + 1;
      if (!b.externalId || existingIds.has(b.externalId)) {
        skipped++;
        return;
      }
      if (!b.amountCents || b.amountCents === 0n) {
        failed++;
        failures.push({ rowNo, reason: '金额无效' });
        return;
      }

      // 分类解析：优先用户指定 categoryId，否则映射 sourceCategory
      let categoryId = b.categoryId;
      if (!categoryId) {
        const mapped = this.mapCategory(b.sourceCategory, b.billType);
        if (mapped) {
          const cacheKey = `${b.billType}:${mapped}`;
          categoryId = categoryCache.get(cacheKey);
        }
      }

      createMany.push({
        userId,
        accountId: accountId ? accountId : null,
        categoryId: categoryId || null,
        amount: b.amountCents,
        billType: b.billType,
        note: b.remark || null,
        source,
        externalId: b.externalId,
        neutral: b.neutral,
        rawData: b.rawData ? { data: b.rawData } : undefined,
        billDate: this.normalizeTime(b.time),
      });
    });

    if (createMany.length > 0) {
      await this.prisma.bill.createMany({ data: createMany });
    }
    success = createMany.length;

    const batch = await this.prisma.importBatch.create({
      data: {
        userId,
        source,
        fileName,
        total: bills.length,
        success,
        skipped,
        failed,
        status: 'done',
      },
    });

    if (failures.length > 0) {
      await this.prisma.importFailure.createMany({
        data: failures.map((f) => ({ batchId: batch.id, rowNo: f.rowNo, reason: f.reason, raw: f.raw ? { data: f.raw } : undefined })),
      });
    }

    return { batchId: batch.id, total: bills.length, success, skipped, failed };
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

  protected mapCategory(sourceCategory: string | undefined, billType: string): string | undefined {
    if (!sourceCategory) return undefined;
    if (billType === 'neutral') return undefined;
    // 微信：账单里 sourceCategory = 交易类型（商户消费/转账/红包等），用通用规则
    const mapped = ALIPAY_CATEGORY_MAP[sourceCategory];
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
}