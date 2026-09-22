import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 账户列表：返回父子树结构（顶层账户含 children 子账户数组） */
  async list(userId: bigint, query: { keyword?: string; type?: string } = {}) {
    const where: any = { userId };
    if (query.type) where.type = query.type;
    if (query.keyword) where.name = { contains: query.keyword };
    const accounts = await this.prisma.account.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    const childrenMap = new Map<string, any[]>();
    const roots: any[] = [];
    for (const a of accounts) {
      const item = {
        ...a,
        id: a.id.toString(),
        parentId: a.parentId?.toString() ?? null,
        balance: a.balance.toString(),
        children: [] as any[],
      };
      if (item.parentId) {
        const list = childrenMap.get(item.parentId) || [];
        list.push(item);
        childrenMap.set(item.parentId, list);
      } else {
        roots.push(item);
      }
    }
    for (const r of roots) r.children = childrenMap.get(r.id) || [];
    // 孤儿子账户（父账户被过滤/删除导致不在本次结果）直接以顶层展示，避免数据丢失
    const presentIds = new Set(accounts.map((a) => a.id.toString()));
    const ret = [...roots];
    for (const [pid, items] of childrenMap) {
      if (!presentIds.has(pid)) ret.push(...items);
    }
    return ret;
  }

  async get(userId: bigint, id: bigint) {
    const account = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException('账户不存在');
    return account;
  }

  async create(userId: bigint, dto: CreateAccountDto) {
    const parentId = dto.parentId ? BigInt(dto.parentId) : null;
    if (parentId) {
      const parent = await this.prisma.account.findFirst({ where: { id: parentId, userId } });
      if (!parent) throw new BadRequestException('父账户不存在');
    }
    // 同名校验：同一父账户（或顶层）下不可重名
    const dup = await this.prisma.account.findFirst({
      where: { userId, parentId, name: dto.name },
    });
    if (dup) throw new BadRequestException('同一父账户下已存在同名账户');
    return this.prisma.account.create({
      data: { userId, parentId, name: dto.name, type: dto.type || 'other', balance: BigInt(dto.balance || 0) },
    });
  }

  async update(userId: bigint, id: bigint, dto: UpdateAccountDto) {
    await this.get(userId, id);
    return this.prisma.account.update({
      where: { id },
      data: { ...dto, balance: dto.balance !== undefined ? BigInt(dto.balance) : undefined },
    });
  }

  async remove(userId: bigint, id: bigint) {
    await this.get(userId, id);
    await this.assertNoChildren(userId, id);
    await this.prisma.account.delete({ where: { id } });
    return { success: true };
  }

  /** 批量删除：按 ids 删除（限定当前用户），关联账单保留但脱离账户；父账户存在子账户时拒绝删除 */
  async removeMany(userId: bigint, ids: string[]) {
    const idList = [...new Set(ids)].map((i) => BigInt(i)).filter((i) => !isNaN(Number(i)));
    if (idList.length === 0) return { success: false, message: '未选择账户' };
    for (const id of idList) {
      await this.assertNoChildren(userId, id);
    }
    const result = await this.prisma.account.deleteMany({
      where: { userId, id: { in: idList } },
    });
    return { success: true, removed: result.count };
  }

  // 父账户有子账户时禁止删除
  private async assertNoChildren(userId: bigint, id: bigint) {
    const childCount = await this.prisma.account.count({ where: { userId, parentId: id } });
    if (childCount > 0) throw new BadRequestException('该账户下存在子账户，请先删除子账户');
  }
}