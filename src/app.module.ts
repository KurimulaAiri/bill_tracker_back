import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { SignatureGuard } from './common/guard/signature.guard';
import { AuthModule } from './modules/auth/auth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BillsModule } from './modules/bills/bills.module';
import { StatsModule } from './modules/stats/stats.module';
import { ImportsModule } from './modules/imports/imports.module';
import { FieldMappingsModule } from './modules/field-mappings/field-mappings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AccountsModule,
    CategoriesModule,
    BillsModule,
    StatsModule,
    ImportsModule,
    FieldMappingsModule,
  ],
  providers: [
    // 全局请求签名校验（HMAC-SHA256 + 时间戳窗口 + nonce 防重放）
    { provide: APP_GUARD, useClass: SignatureGuard },
  ],
})
export class AppModule {}