import { Controller, Post, Get, UseGuards, Body, Param, UploadedFile, UseInterceptors, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../../common/guard/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

const uploadDir = process.env.UPLOAD_DIR || './uploads';

@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) return { error: '未收到文件' };
    try {
      // 兼容大整数：返回前把 bigint 转 string
      const result = await this.importsService.parseUpload(user.userId, file);
      const bills = result.parse.bills.map((b) => ({
        ...b,
        amountCents: b.amountCents.toString(),
        id: crypto.randomUUID(),
      }));
      return {
        parse: { ...result.parse, bills },
        hints: result.hints,
      };
    } finally {
      // 解析完成后删除临时文件
      setTimeout(() => {
        if (fs.existsSync(file.path)) {
          fs.unlink(file.path, () => undefined);
        }
      }, 5000);
    }
  }

  @Post('confirm')
  async confirm(@CurrentUser() user: AuthUser, @Body() body: any) {
    const { source, fileName, accountId, bills } = body || {};
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
}