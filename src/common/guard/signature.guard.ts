import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';

export const SKIP_SIGNATURE = 'SKIP_SIGNATURE';
/** 标记无需签名校验的接口（如文件上传 multipart） */
export const SkipSignature = () => SetMetadata(SKIP_SIGNATURE, true);

@Injectable()
export class SignatureGuard implements CanActivate {
  // 服务器进程内已消费的 nonce（防重放），带过期时间
  private usedNonces = new Map<string, number>();
  private readonly TIME_WINDOW_SEC = 300; // 时间戳允许误差 ±5 分钟
  private readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

  constructor(private readonly reflector: Reflector) {
    const timer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL_MS);
    timer.unref?.();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SIGNATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest();
    const ts = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];
    const sign = req.headers['x-sign'];
    if (!ts || !nonce || !sign) {
      throw new UnauthorizedException('缺少签名头');
    }

    // 1. 时间戳窗口校验
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) throw new UnauthorizedException('签名时间戳无效');
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > this.TIME_WINDOW_SEC) {
      throw new UnauthorizedException('签名已过期');
    }

    // 2. nonce 防重放（同一请求只能使用一次）
    if (this.usedNonces.has(`${ts}_${nonce}`)) {
      throw new UnauthorizedException('请求已重放');
    }

    // 3. 签名校验
    const secret = process.env.SIGN_SECRET || 'bill-tracker-sign-secret';
    const method = req.method.toUpperCase();
    const path = req.originalUrl.split('?')[0];
    const queryStr = this.normalizeQuery(req.query);
    const bodyStr = this.normalizeBody(req.body);
    const canonical = [method, path, queryStr, bodyStr, String(ts), String(nonce)].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    const provided = String(sign);
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException('签名校验失败');
    }

    // 记录 nonce（写入当前时间，用于过期清理）
    this.usedNonces.set(`${ts}_${nonce}`, nowSec);
    return true;
  }

  /** query 对象 -> 按键排序的 k=v 拼接 */
  private normalizeQuery(query: any): string {
    if (!query || typeof query !== 'object') return '';
    return Object.keys(query)
      .sort()
      .map((k) => {
        const v = query[k];
        const val = Array.isArray(v) ? v.join(',') : String(v);
        return `${k}=${val}`;
      })
      .join('&');
  }

  /** body 对象 -> 稳定的 JSON 字符串 */
  private normalizeBody(body: any): string {
    if (body === undefined || body === null) return '';
    if (typeof body !== 'object') return String(body);
    // 空对象视为空串（GET 等无 body 请求：前端签名为 ''，后端 req.body 为 {}）
    if (Object.keys(body).length === 0) return '';
    return JSON.stringify(this.sortKeys(body));
  }

  /** 递归按键排序，保证与前端序列化一致 */
  private sortKeys(obj: any): any {
    if (Array.isArray(obj)) return obj.map((i) => (i && typeof i === 'object' ? this.sortKeys(i) : i));
    if (obj && typeof obj === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(obj).sort()) {
        out[k] = obj[k] && typeof obj[k] === 'object' ? this.sortKeys(obj[k]) : obj[k];
      }
      return out;
    }
    return obj;
  }

  private cleanup() {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, t] of this.usedNonces) {
      if (now - t > this.TIME_WINDOW_SEC * 2) this.usedNonces.delete(key);
    }
  }
}