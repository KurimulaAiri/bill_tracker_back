import { Controller, Get, Post, Put, Delete, Query, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.accountsService.list(user.userId, { keyword: query.keyword, type: query.type });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(user.userId, dto);
  }

  // 批量删除：body { ids: string[] }
  @Post('batch-delete')
  removeMany(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.accountsService.removeMany(user.userId, body?.ids || []);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(user.userId, BigInt(id), dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.accountsService.remove(user.userId, BigInt(id));
  }
}