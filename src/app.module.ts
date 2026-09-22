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
    ConfigModule.forRoot({
      isGlobal: true,
      // 加载顺序：先 .env（密钥，不入库），再 .env.<NODE_ENV>（环境配置，入库、可覆盖）
      envFilePath: ['.env', `.env.${process.env.NODE_ENV || 'development'}`],
    }),
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