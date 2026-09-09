import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { FieldMappingsService } from './field-mappings.service';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('field-mappings')
@UseGuards(JwtAuthGuard)
export class FieldMappingsController {
  constructor(private readonly fieldMappingsService: FieldMappingsService) {}

  @Get()
  all(@CurrentUser() user: AuthUser) {
    return this.fieldMappingsService.all(user.userId);
  }

  // body: { mappings: [{ source, field, columnName }] }
  @Put()
  save(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.fieldMappingsService.save(user.userId, body?.mappings || []);
  }
}