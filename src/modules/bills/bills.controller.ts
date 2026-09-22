import { Controller, Get, Post, Put, Delete, Query, Body, Param, UseGuards, ParseIntPipe, Res } from '@nestjs/common';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import type { Response } from 'express';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.billsService.list(user.userId, {
      page: query.page,
      pageSize: query.pageSize,
      source: query.source,
      categoryId: query.categoryId,
      accountId: query.accountId,
      billType: query.billType,
      start: query.start,
      end: query.end,
      keyword: query.keyword,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    });
  }

  // 导出账单：按条件/指定 ids 导出全部匹配记录（xlsx/csv），必须在 @Get(':id') 之前声明
  @Get('export')
  async exportBills(@CurrentUser() user: AuthUser, @Query() query: any, @Res() res: Response) {
    const format: 'xlsx' | 'csv' = query.format === 'csv' ? 'csv' : 'xlsx';
    const { filename, buffer, contentType } = await this.billsService.exportBills(
      user.userId,
      {
        ids: query.ids ? String(query.ids).split(',').filter(Boolean) : undefined,
        source: query.source,
        categoryId: query.categoryId,
        accountId: query.accountId,
        billType: query.billType,
        start: query.start,
        end: query.end,
        keyword: query.keyword,
      },
      format,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }

  // 导出预览：返回匹配总数与抽样记录（body 同导出条件，支持 ids）
  @Post('export-preview')
  exportPreview(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.billsService.previewExport(user.userId, body || {});
  }

  // 单条详情：必须在批量删除等 POST 路由之前无所谓，但需放在 @Get() 之后
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.billsService.detail(user.userId, BigInt(id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBillDto) {
    return this.billsService.create(user.userId, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateBillDto) {
    return this.billsService.update(user.userId, BigInt(id), dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.billsService.remove(user.userId, BigInt(id));
  }

  // 批量删除：body { ids: string[] }
  @Post('batch-delete')
  removeMany(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.billsService.removeMany(user.userId, body?.ids || []);
  }

  // 条件删除：body { start?, end?, billType?, source?, categoryId?, accountId?, keyword? }
  @Post('delete-by-condition')
  removeByCondition(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.billsService.removeByCondition(user.userId, body || {});
  }

  // 批处理：body { field, keyword, source?, billType?, start?, end?, categoryWhere?, action, categoryId?, accountId? }
  @Post('batch-update')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.billsService.batchUpdate(user.userId, body || {});
  }

  // 批处理预览：body 同 batch-update，返回匹配总数与有限条记录
  @Post('batch-preview')
  batchPreview(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.billsService.batchPreview(user.userId, body || {});
  }
}