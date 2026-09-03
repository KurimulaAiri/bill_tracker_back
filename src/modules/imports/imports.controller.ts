import { Controller, Post, Get, UseGuards, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

// 账单文件已改为浏览器本地解析（前端 src/imports），本控制器只负责预览确认入库与批次管理
@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('confirm')
  async confirm(@CurrentUser() user: AuthUser, @Body() body: any) {
    const { source, fileName, accountId, groupId, skips, bills } = body || {};
    if (!source || !Array.isArray(bills)) {
      return { error: '参数错误' };
    }
    // 前端传来的 amountCents 是字符串，转 bigint
    const normalized = bills.map((b: any) => ({
      ...b,
      amountCents: BigInt((b.amountCents as string) || '0'),
      time: b.time,
      externalId: b.externalId || undefined,
      sourceCategory: b.sourceCategory || undefined,
      remark: b.remark || undefined,
      rawData: b.rawData || undefined,
    }));
    return this.importsService.confirmImport(user.userId, {
      source,
      fileName: fileName || '',
      accountId: accountId ? BigInt(accountId) : undefined,
      groupId: groupId || undefined,
      skips: Array.isArray(skips) ? skips : undefined,
      bills: normalized,
    });
  }

  @Get('batches')
  batches(@CurrentUser() user: AuthUser) {
    return this.importsService.batches(user.userId);
  }

  @Get('batches/:id')
  batchDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.importsService.batchDetail(user.userId, BigInt(id));
  }

  // 手动去重：清理数据库中重复账单（按平台标识/内容指纹）
  @Post('dedupe')
  dedupe(@CurrentUser() user: AuthUser) {
    return this.importsService.dedupe(user.userId);
  }
}