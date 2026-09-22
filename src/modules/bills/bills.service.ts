import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
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
      sortField?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Number(query.pageSize) || 20);

    const where = await this.buildListWhere(userId, query);

    // 列排序：仅允许白名单字段，非法字段回落为时间倒序
    const sortableMap: Record<string, string> = {
      billDate: 'billDate',
      amount: 'amount',
      counterParty: 'counterParty',
      note: 'note',
    };
    const orderField = (query.sortField && sortableMap[query.sortField]) || 'billDate';
    const order = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: any = { [orderField]: order };

    const total = await this.prisma.bill.count({ where });

    let items: any[];
    if (orderField === 'amount') {
      // 金额列显示为绝对值、支出为负，排序须按 |金额| 计算（Prisma orderBy 不支持函数表达式），
      // 故先取匹配记录的 id+amount，在内存中按绝对值排序后分页
      const pairs = await this.prisma.bill.findMany({
        where,
        select: { id: true, amount: true },
      });
      const sortedIds = pairs
        .map((b) => ({ id: b.id, abs: Math.abs(Number(b.amount)) }))
        .sort((a, b) => (order === 'asc' ? a.abs - b.abs : b.abs - a.abs))
        .slice((page - 1) * pageSize, page * pageSize)
        .map((r) => r.id);
      if (sortedIds.length) {
        const fetched = await this.prisma.bill.findMany({
          where: { id: { in: sortedIds }, ...where },
          include: {
            category: { select: { id: true, name: true, icon: true } },
            account: { select: { id: true, name: true } },
          },
        });
        // 按排序后的 id 顺序重排
        const byId = new Map(fetched.map((b) => [b.id.toString(), b]));
        items = sortedIds.map((id) => byId.get(id.toString())).filter(Boolean) as any[];
      } else {
        items = [];
      }
    } else {
      items = await this.prisma.bill.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true, icon: true } },
          account: { select: { id: true, name: true } },
        },
      });
    }

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
    const where = await this.buildBatchWhere(userId, dto);

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
    const where = await this.buildBatchWhere(userId, dto);
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
  protected async buildBatchWhere(
    userId: bigint,
    dto: { field: string; keyword?: string; source?: string; billType?: string; start?: string; end?: string; categoryWhere?: string },
  ): Promise<any> {
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
    const keyword = dto.keyword && dto.keyword.trim();
    if (keyword) {
      // 交易类型存入 extraJson 的"交易类型"键，MySQL 需用原生 SQL 匹配；其余为普通列
      if (dto.field === 'extraJsonType') {
        where.id = { in: await this.matchExtraJsonTypeIds(userId, keyword) };
      } else {
        where[dto.field] = { contains: keyword };
      }
    }
    return where;
  }

  /** 原生 SQL 匹配 extraJson 中"交易类型"键包含关键词的记录 id（MySQL 不支持 Prisma 的 JSON path 过滤） */
  private async matchExtraJsonTypeIds(userId: bigint, keyword: string): Promise<bigint[]> {
    const like = `%${keyword.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT id FROM bill_bill
      WHERE userId = ${userId} AND JSON_EXTRACT(extraJson, '$."交易类型"') LIKE ${like} ESCAPE '\\\\'
    `);
    return rows.map((r) => r.id);
  }

  /** 列表/导出通用条件构建（含关键词多字段模糊搜索与交易类型原生 SQL 匹配） */
  private async buildListWhere(
    userId: bigint,
    query: { source?: string; categoryId?: string; accountId?: string; billType?: string; start?: string; end?: string; keyword?: string },
  ): Promise<any> {
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
        const ands: any[] = [];
        for (const term of terms) {
          // extraJson 的"交易类型"匹配：MySQL 不支持 Prisma 的 JSON path 过滤，需用原生 SQL 查 id
          const extraIds = await this.matchExtraJsonTypeIds(userId, term);
          ands.push({
            OR: [
              { note: { contains: term } },
              { counterParty: { contains: term } },
              { counterpartyAccount: { contains: term } },
              { externalId: { contains: term } },
              { merchantNo: { contains: term } },
              { status: { contains: term } },
              { payMethod: { contains: term } },
              { cardNo: { contains: term } },
              extraIds.length ? { id: { in: extraIds } } : { id: { in: [] } },
            ],
          });
        }
        where.AND = ands;
      }
    }
    return where;
  }

  private readonly SOURCE_LABELS: Record<string, string> = {
    manual: '手工',
    alipay: '支付宝',
    wechat: '微信',
    ccb_saving: '建行活期',
    ccb_credit: '建行信用卡',
    export: '本地导出',
  };

  // 导出列定义：表头 + 行数据 key
  private readonly EXPORT_COLUMNS = [
    { header: '时间', key: 'billDate' },
    { header: '金额', key: 'amountYuan' },
    { header: '收支类型', key: 'billTypeLabel' },
    { header: '分类', key: 'category' },
    { header: '账户', key: 'account' },
    { header: '来源', key: 'sourceLabel' },
    { header: '对方', key: 'counterParty' },
    { header: '对方账号', key: 'counterpartyAccount' },
    { header: '商户单号', key: 'merchantNo' },
    { header: '交易订单号', key: 'externalId' },
    { header: '交易状态', key: 'status' },
    { header: '收/付款方式', key: 'payMethod' },
    { header: '卡号', key: 'cardNo' },
    { header: '交易类型', key: 'extraJsonType' },
    { header: '优惠/减免', key: 'extraJsonPerk' },
    { header: '额外信息(JSON)', key: 'extraJson' },
    { header: '原始数据(JSON)', key: 'rawData' },
    { header: '备注', key: 'note' },
    { header: '来源分组', key: 'importGroupId' },
    { header: '来源文件', key: 'batchFileName' },
  ];

  /** 按条件/指定 ids 导出匹配账单（xlsx / csv），按时间升序 */
  async exportBills(
    userId: bigint,
    query: { ids?: string[]; source?: string; categoryId?: string; accountId?: string; billType?: string; start?: string; end?: string; keyword?: string },
    format: 'xlsx' | 'csv',
  ): Promise<{ filename: string; buffer: Buffer; contentType: string }> {
    const where = await this.resolveExportWhere(userId, query);
    const bills = await this.prisma.bill.findMany({
      where,
      orderBy: { billDate: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
      },
    });

    const rows = bills.map((b) => ({
      billDate: this.formatDateTime(b.billDate),
      amountYuan: (Number(b.amount) / 100).toFixed(2),
      billTypeLabel: b.billType === 'income' ? '收入' : b.billType === 'expense' ? '支出' : '不计收支',
      category: b.category?.name ?? '',
      account: b.account?.name ?? '',
      sourceLabel: this.SOURCE_LABELS[b.source] ?? b.source,
      counterParty: b.counterParty ?? '',
      counterpartyAccount: b.counterpartyAccount ?? '',
      merchantNo: b.merchantNo ?? '',
      externalId: b.externalId ?? '',
      status: b.status ?? '',
      payMethod: b.payMethod ?? '',
      cardNo: b.cardNo ?? '',
      extraJsonType: (b.extraJson as any)?.['交易类型'] ?? '',
      extraJsonPerk: (b.extraJson as any)?.['优惠/减免'] ?? '',
      extraJson: b.extraJson ? JSON.stringify(b.extraJson) : '',
      rawData: b.rawData ? JSON.stringify(b.rawData) : '',
      note: b.note ?? '',
      importGroupId: b.importGroupId ? b.importGroupId.toString() : '',
      batchFileName: b.batchFileName ?? '',
    }));

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `账单导出-${dateStr}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('账单');
      ws.columns = this.EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key }));
      ws.getRow(1).font = { bold: true };
      rows.forEach((r) => ws.addRow(r));
      const buf: any = await wb.xlsx.writeBuffer();
      return {
        filename,
        buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    // CSV（带 UTF-8 BOM，Excel 打开不乱码）
    const escape = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [this.EXPORT_COLUMNS.map((c) => c.header).map(escape).join(',')];
    for (const r of rows) lines.push(this.EXPORT_COLUMNS.map((c) => escape(String(r[c.key] ?? ''))).join(','));
    return {
      filename,
      buffer: Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
    };
  }

  private formatDateTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // 导出/预览通用 where：指定 ids 优先（勾选行导出），否则按条件筛选
  private async resolveExportWhere(
    userId: bigint,
    query: { ids?: string[]; source?: string; categoryId?: string; accountId?: string; billType?: string; start?: string; end?: string; keyword?: string },
  ): Promise<any> {
    if (query.ids && query.ids.length) {
      const idList = [...new Set(query.ids.map((i) => BigInt(i)).filter((i) => !isNaN(Number(i))))];
      return { userId, id: { in: idList } };
    }
    return this.buildListWhere(userId, query);
  }

  /** 导出预览：返回匹配总数与有限条抽样记录（含分类/账户，便于确认导出范围） */
  async previewExport(userId: bigint, dto: any, limit = 30) {
    const where = await this.resolveExportWhere(userId, dto);
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
}