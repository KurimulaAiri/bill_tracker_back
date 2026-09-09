import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // 系统预置 (userId=null) + 用户自定义
  list(userId: bigint) {
    return this.prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
  }

  create(userId: bigint, dto: CreateCategoryDto) {
    return this.prisma.category
      .create({
        data: {
          userId,
          name: dto.name,
          type: dto.type || 'expense',
          icon: dto.icon,
          sort: dto.sort || 0,
          aliases: dto.aliases && dto.aliases.length ? dto.aliases : undefined,
        },
      })
      .catch((e) => this.duplicateCheck(e));
  }

  // 允许用户修改全部分类（包括系统预置），无需权限限制
  async getOwned(_userId: bigint, id: bigint) {
    const cat = await this.prisma.category.findFirst({ where: { id } });
    if (!cat) throw new NotFoundException('分类不存在');
    return cat;
  }

  async update(userId: bigint, id: bigint, dto: Partial<CreateCategoryDto>) {
    await this.getOwned(userId, id);
    // aliases 为 Json 类型，null 不被接受：显式构造 data，仅传存在的字段（空数组表示清空映射）
    const data: any = { name: dto.name, type: dto.type, icon: dto.icon, sort: dto.sort };
    if (dto.aliases !== undefined) data.aliases = dto.aliases;
    return this.prisma.category
      .update({ where: { id }, data })
      .catch((e) => this.duplicateCheck(e));
  }

  async remove(userId: bigint, id: bigint) {
    await this.getOwned(userId, id);
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }

  // 唯一索引 [userId, name, type] 冲突时给出友好提示
  protected duplicateCheck(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('同名同类型分类已存在');
    }
    throw e;
  }
}