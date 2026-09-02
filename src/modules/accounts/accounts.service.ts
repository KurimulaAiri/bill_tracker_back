import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: bigint) {
    return this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(userId: bigint, id: bigint) {
    const account = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw new NotFoundException('账户不存在');
    return account;
  }

  create(userId: bigint, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: { userId, name: dto.name, type: dto.type || 'other', balance: BigInt(dto.balance || 0) },
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
    await this.prisma.account.delete({ where: { id } });
    return { success: true };
  }
}