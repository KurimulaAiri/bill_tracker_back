import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // 关闭内置 body 解析，改由下方显式配置：账单导入是「整批账单一次性 POST」，
  // 每笔都带 rawData 原始行，Express 默认 100kb 远远不够
  // （2026-09 支付宝 153 笔约 123KB，会直接被 body-parser 以 413 "request entity too large" 拒绝，
  //   而 2026-08 的 112 笔约 90KB 恰好没超，所以表现为「上个月能导、这个月报错」）。
  // 上限放到 20mb，与 nginx 的 client_max_body_size 20m 对齐。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

  // BigInt 序列化为字符串，避免 JSON.stringify 报错
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/api`);
}
bootstrap();
