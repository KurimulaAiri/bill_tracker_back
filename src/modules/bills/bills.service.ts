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
    if (query.start || query.end) {
      where.billDate = {
        ...(query.start ? { gte: new Date(query.start) } : {}),
        ...(query.end ? { lte: new Date(query.end) } : {}),
      };
    }
    if (query.keyword) {
      where.note = { contains: query.keyword };
    }

    const [total, items] = await Promise.all([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: { billDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: { select: { id: true, name: true, icon: true } }, account: { select: { id: true, name: true } } },
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
      })),
    };
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
}