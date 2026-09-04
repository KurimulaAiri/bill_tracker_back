import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // 默认排除 neutral 账单；支持按来源筛选；范围支持单月 month 或日期区间 start/end
  async summary(userId: bigint, query: { month?: string; source?: string; start?: string; end?: string }) {
    const { start, end } = this.rangeFor(query);
    const where = this.baseWhere(userId, query.source, start, end);

    const rows = await this.prisma.bill.groupBy({
      by: ['billType'],
      where,
      _sum: { amount: true },
    });

    let income = 0n, expense = 0n, neutral = 0n;
    for (const r of rows) {
      const sum = this.absAmount(r._sum.amount);
      if (r.billType === 'income') income = sum;
      else if (r.billType === 'expense') expense = sum;
      else neutral = sum;
    }
    return {
      month: query.month || this.currentMonth(),
      income: income.toString(),
      expense: expense.toString(),
      balance: (income - expense).toString(),
      neutral: neutral.toString(),
    };
  }

  // 分类占比（支出侧）
  async category(userId: bigint, query: { month?: string; source?: string; type?: string; start?: string; end?: string }) {
    const { start, end } = this.rangeFor(query);
    const where = this.baseWhere(userId, query.source, start, end);
    where.billType = query.type || 'expense';
    where.categoryId = { not: null };

    const rows = await this.prisma.bill.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
    });

    const cats = await this.prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] } });
    const catMap = new Map(cats.map((c) => [c.id.toString(), c]));

    let total = 0n;
    const items = rows.map((r) => {
      const amount = this.absAmount(r._sum.amount);
      total += amount;
      const cat = catMap.get(r.categoryId!.toString());
      return {
        categoryId: r.categoryId!.toString(),
        name: cat?.name || '未分类',
        amount: amount.toString(),
      };
    });

    return {
      total: total.toString(),
      items: items
        .map((i) => ({ ...i, percent: total > 0n ? Number((BigInt(i.amount) * 10000n) / total) / 100 : 0 }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    };
  }

  // 收支趋势（按月，默认近12个月）
  async trend(userId: bigint, query: { source?: string; months?: number }) {
    const months = Math.min(24, Math.max(3, Number(query.months) || 12));
    const now = new Date();
    const labels: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const start = `${labels[0]}-01T00:00:00+08:00`;
    const end = `${labels[labels.length - 1]}-31T23:59:59+08:00`;

    const where = this.baseWhere(userId, query.source, start, end);
    const rows = await this.prisma.bill.groupBy({
      by: ['billType', 'billDate'],
      where,
      _sum: { amount: true },
    });

    const incomeMap = new Map<string, bigint>();
    const expenseMap = new Map<string, bigint>();
    for (const r of rows) {
      const key = `${r.billDate.getFullYear()}-${String(r.billDate.getMonth() + 1).padStart(2, '0')}`;
      const sum = this.absAmount(r._sum.amount);
      if (r.billType === 'income') incomeMap.set(key, (incomeMap.get(key) || 0n) + sum);
      else if (r.billType === 'expense') expenseMap.set(key, (expenseMap.get(key) || 0n) + sum);
    }

    return labels.map((l) => ({
      month: l,
      income: (incomeMap.get(l) || 0n).toString(),
      expense: (expenseMap.get(l) || 0n).toString(),
    }));
  }

  protected baseWhere(userId: bigint, source?: string, start?: string, end?: string): any {
    const where: any = { userId, neutral: false };
    if (source) where.source = source;
    if (start || end) {
      where.billDate = {
        ...(start ? { gte: new Date(start) } : {}),
        ...(end ? { lte: new Date(end) } : {}),
      };
    }
    return where;
  }

  protected absAmount(sum?: bigint | null): bigint {
    if (sum === null || sum === undefined) return 0n;
    return sum < 0n ? -sum : sum;
  }

  protected rangeFor(query: { month?: string; start?: string; end?: string }): { start?: string; end?: string } {
    // 优先使用日期区间；否则回退单月
    if (query.start || query.end) {
      return {
        start: query.start ? `${query.start}T00:00:00+08:00` : undefined,
        end: query.end ? `${query.end}T23:59:59+08:00` : undefined,
      };
    }
    return this.monthRange(query.month);
  }

  protected monthRange(month?: string): { start: string; end: string } {
    const m = month || this.currentMonth();
    const [y, mo] = m.split('-').map(Number);
    return {
      start: `${m}-01T00:00:00+08:00`,
      end: `${m}-${new Date(y, mo, 0).getDate()}T23:59:59+08:00`,
    };
  }

  protected currentMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}