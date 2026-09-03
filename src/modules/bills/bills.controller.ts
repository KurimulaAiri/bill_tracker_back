import { Controller, Get, Post, Delete, Query, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

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
      start: query.start,
      end: query.end,
      keyword: query.keyword,
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBillDto) {
    return this.billsService.create(user.userId, dto);
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
}