import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    try {
      const secret = this.configService.get<string>('JWT_SECRET') || 'bill-tracker-dev-secret-change-me';
      const payload = await this.jwtService.verifyAsync(token, { secret });
      request.user = { userId: BigInt(payload.sub), username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException('登录已过期');
    }
  }
}