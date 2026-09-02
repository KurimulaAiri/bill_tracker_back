import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.statsService.summary(user.userId, { month: query.month, source: query.source });
  }

  @Get('category')
  category(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.statsService.category(user.userId, { month: query.month, source: query.source, type: query.type });
  }

  @Get('trend')
  trend(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.statsService.trend(user.userId, { source: query.source, months: query.months });
  }
}