import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) {
      throw new ConflictException('用户名已存在');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        email: dto.email,
      },
    });
    return this.buildAuthPayload(user.id, user.username);
  }

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    return this.buildAuthPayload(user.id, user.username);
  }

  async me(userId: bigint) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, createdAt: true },
    });
    return user;
  }

  /** 修改密码：校验旧密码后更新哈希，返回新 token 保持登录态 */
  async changePassword(userId: bigint, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('原密码不正确');
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('新密码不能与原密码相同');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return this.buildAuthPayload(user.id, user.username);
  }

  private buildAuthPayload(userId: bigint, username: string) {
    const accessToken = this.jwtService.sign({
      sub: userId.toString(),
      username,
    });
    return {
      accessToken,
      user: { id: userId.toString(), username },
    };
  }
}