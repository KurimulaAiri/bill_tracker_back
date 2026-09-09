import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateBillDto } from './dto/create-bill.dto';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: bigint,
    query: {
      page?: number;
      pageSize?: number;
      source?: string;
      categoryId?: string;
      accountId?: string;
      billType?: string;
      start?: string;
      end?: string;
      keyword?: string;
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Number(query.pageSize) || 20);

    const where: any = { userId };
    if (query.source) where.source = query.source;
    if (query.categoryId) where.categoryId = BigInt(query.categoryId);
    if (query.accountId) where.accountId = BigInt(query.accountId);
    if (query.billType) where.billType = query.billType;
    if (query.start || query.end) {
      where.billDate = {
        ...(query.start ? { gte: new Date(query.start) } : {}),
        ...(query.end ? { lte: new Date(query.end) } : {}),
      };
    }
    // 关键词联合模糊搜索：以空白分隔多个词，每个词须命中任一字段（备注/对方/单号/类型/状态等），词与词之间为 AND 关系
    if (query.keyword) {
      const terms = String(query.keyword).trim().split(/\s+/).filter(Boolean);
      if (terms.length) {
        where.AND = terms.map((term) => ({
          OR: [
            { note: { contains: term } },
            { counterParty: { contains: term } },
            { counterpartyAccount: { contains: term } },
            { externalId: { contains: term } },
            { merchantNo: { contains: term } },
            { status: { contains: term } },
            { payMethod: { contains: term } },
            { cardNo: { contains: term } },
            { extraJson: { path: ['交易类型'], string_contains: term } },
          ],
        }));
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: { billDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true, icon: true } },
          account: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((b) => ({
        ...b,
        id: b.id.toString(),
        amount: b.amount.toString(),
        categoryId: b.categoryId?.toString(),
        accountId: b.accountId?.toString(),
        importBatchId: b.importBatchId?.toString(),
      })),
    };
  }

  /** 单条账单详情：返回全部字段（含 extraJson/rawData）及关联分类、账户 */
  async detail(userId: bigint, id: bigint) {
    const bill = await this.prisma.bill.findFirst({
      where: { id, userId },
      include: {
        category: { select: { id: true, name: true, icon: true } },
        account: { select: { id: true, name: true } },
      },
    });
    if (!bill) return null;
    return {
      ...bill,
      id: bill.id.toString(),
      amount: bill.amount.toString(),
      categoryId: bill.categoryId?.toString(),
      accountId: bill.accountId?.toString(),
      importBatchId: bill.importBatchId?.toString(),
      importGroupId: bill.importGroupId?.toString(),
      userId: bill.userId.toString(),
    };
  }

  /** 编辑账单：可更新金额/收支类型/备注/账户/分类/时间 */
  async update(userId: bigint, id: bigint, dto: Partial<CreateBillDto>) {
    const bill = await this.prisma.bill.findFirst({ where: { id, userId } });
    if (!bill) return { success: false, message: '账单不存在' };
    await this.prisma.bill.update({
      where: { id },
      data: {
        ...(dto.amountCents !== undefined ? { amount: BigInt(dto.amountCents) } : {}),
        ...(dto.billType ? { billType: dto.billType } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId ? BigInt(dto.accountId) : null } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId ? BigInt(dto.categoryId) : null } : {}),
        ...(dto.billDate ? { billDate: new Date(dto.billDate) } : {}),
      },
    });
    return { success: true };
  }

  create(userId: bigint, dto: CreateBillDto) {
    return this.prisma.bill.create({
      data: {
        userId,
        amount: BigInt(dto.amountCents),
        billType: dto.billType || (dto.amountCents < 0 ? 'expense' : 'income'),
        note: dto.note,
        accountId: dto.accountId ? BigInt(dto.accountId) : null,
        categoryId: dto.categoryId ? BigInt(dto.categoryId) : null,
        billDate: dto.billDate ? new Date(dto.billDate) : new Date(),
        source: 'manual',
      },
    });
  }

  async remove(userId: bigint, id: bigint) {
    const bill = await this.prisma.bill.findFirst({ where: { id, userId } });
    if (!bill) return { success: false, message: '账单不存在' };
    await this.prisma.bill.delete({ where: { id } });
    return { success: true };
  }

  /** 批量删除：按 ids 删除（限定当前用户） */
  async removeMany(userId: bigint, ids: string[]) {
    const idList = [...new Set(ids)].map((i) => BigInt(i)).filter((i) => !isNaN(Number(i)));
    if (idList.length === 0) return { success: false, message: '未选择账单' };
    const result = await this.prisma.bill.deleteMany({
      where: { userId, id: { in: idList } },
    });
    return { success: true, removed: result.count };
  }

  /** 条件删除：按时间范围/收支类型/来源/分类/账户删除，返回删除条数 */
  async removeByCondition(
    userId: bigint,
    cond: { start?: string; end?: string; billType?: string; source?: string; categoryId?: string; accountId?: string; keyword?: string },
  ) {
    const where: any = { userId };
    if (cond.start || cond.end) {
      where.billDate = {
        ...(cond.start ? { gte: new Date(cond.start) } : {}),
        ...(cond.end ? { lte: new Date(cond.end) } : {}),
      };
    }
    if (cond.billType) where.billType = cond.billType;
    if (cond.source) where.source = cond.source;
    if (cond.categoryId) where.categoryId = BigInt(cond.categoryId);
    if (cond.accountId) where.accountId = BigInt(cond.accountId);
    if (cond.keyword) where.note = { contains: cond.keyword };

    const count = await this.prisma.bill.count({ where });
    if (count === 0) return { success: true, removed: 0 };
    const result = await this.prisma.bill.deleteMany({ where });
    return { success: true, removed: result.count };
  }

  /**
   * 批处理：按【时间范围/匹配字段关键词/来源/收支类型/分类】组合条件批量执行操作
   * keyword 可留空（此时不按字段关键词匹配）；action: category=设置分类 account=设置账户 delete=删除
   */
  async batchUpdate(
    userId: bigint,
    dto: {
      field: string;
      keyword?: string;
      source?: string;
      billType?: string;
      start?: string;
      end?: string;
      categoryWhere?: string;
      action: 'category' | 'account' | 'delete';
      categoryId?: string;
      accountId?: string;
    },
  ) {
    const where = this.buildBatchWhere(userId, dto);

    if (dto.action === 'delete') {
      const r = await this.prisma.bill.deleteMany({ where });
      return { action: dto.action, affected: r.count };
    }
    const data: any = {};
    if (dto.action === 'category' && dto.categoryId) data.categoryId = BigInt(dto.categoryId);
    if (dto.action === 'account' && dto.accountId) data.accountId = BigInt(dto.accountId);
    const r = await this.prisma.bill.updateMany({ where, data });
    return { action: dto.action, affected: r.count };
  }

  /**
   * 批处理预览：返回匹配总数与有限条匹配记录（含当前分类/账户，便于展示"修改后"的效果）
   */
  async batchPreview(userId: bigint, dto: any, limit = 30) {
    const where = this.buildBatchWhere(userId, dto);
    const [total, items] = await Promise.all([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: { billDate: 'desc' },
        take: limit,
        include: {
          category: { select: { id: true, name: true, icon: true } },
          account: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      total,
      limit,
      items: items.map((b) => ({
        id: b.id.toString(),
        billDate: b.billDate,
        amount: b.amount.toString(),
        billType: b.billType,
        counterParty: b.counterParty,
        note: b.note,
        category: b.category,
        account: b.account,
      })),
    };
  }

  // 批处理通用条件构建（batchUpdate/batchPreview 共用）
  protected buildBatchWhere(
    userId: bigint,
    dto: { field: string; keyword?: string; source?: string; billType?: string; start?: string; end?: string; categoryWhere?: string },
  ): any {
    const where: any = { userId };
    if (dto.source) where.source = dto.source;
    if (dto.billType) where.billType = dto.billType;
    if (dto.categoryWhere) where.categoryId = BigInt(dto.categoryWhere);
    if (dto.start || dto.end) {
      where.billDate = {
        ...(dto.start ? { gte: new Date(dto.start) } : {}),
        ...(dto.end ? { lte: new Date(dto.end) } : {}),
      };
    }
    // 关键词可留空：留空时不按字段内容匹配，仅按其余条件过滤
    if (dto.keyword && dto.keyword.trim()) {
      // 交易类型存入 extraJson 的"交易类型"键，其余为普通列
      if (dto.field === 'extraJsonType') {
        where.extraJson = { path: ['交易类型'], string_contains: dto.keyword.trim() };
      } else {
        where[dto.field] = { contains: dto.keyword.trim() };
      }
    }
    return where;
  }
}