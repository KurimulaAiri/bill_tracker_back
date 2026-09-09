import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class FieldMappingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 返回该用户全部映射，结构 { source: { field: columnName } }；未配置的字段不出现在结果中 */
  async all(userId: bigint): Promise<Record<string, Record<string, string>>> {
    const rows = await this.prisma.fieldMapping.findMany({ where: { userId } });
    const map: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      if (!map[r.source]) map[r.source] = {};
      map[r.source][r.field] = r.columnName;
    }
    return map;
  }

  /**
   * 批量保存映射：columnName 为空表示清除该字段配置（回到系统默认）。
   * 按 (userId, source, field) upsert。
   */
  async save(userId: bigint, mappings: { source: string; field: string; columnName?: string }[]) {
    for (const m of mappings || []) {
      if (!m.source || !m.field) continue;
      const columnName = String(m.columnName || '').trim();
      if (!columnName) {
        await this.prisma.fieldMapping.deleteMany({ where: { userId, source: m.source, field: m.field } });
      } else {
        await this.prisma.fieldMapping.upsert({
          where: { userId_source_field: { userId, source: m.source, field: m.field } },
          update: { columnName },
          create: { userId, source: m.source, field: m.field, columnName },
        });
      }
    }
    return { success: true };
  }
}