import { Module } from '@nestjs/common';
import { FieldMappingsService } from './field-mappings.service';
import { FieldMappingsController } from './field-mappings.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FieldMappingsController],
  providers: [FieldMappingsService],
})
export class FieldMappingsModule {}