import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';

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
    return this.prisma.category.create({
      data: { userId, name: dto.name, type: dto.type || 'expense', icon: dto.icon, sort: dto.sort || 0 },
    });
  }

  async getOwned(userId: bigint, id: bigint) {
    const cat = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!cat) throw new NotFoundException('分类不存在');
    return cat;
  }

  async update(userId: bigint, id: bigint, dto: Partial<CreateCategoryDto>) {
    await this.getOwned(userId, id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(userId: bigint, id: bigint) {
    await this.getOwned(userId, id);
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }
}