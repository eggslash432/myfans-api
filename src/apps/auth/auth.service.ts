// api/src/apps/auth/auth.service.ts

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { ChangePasswordDto } from './dto/change-password.dto';

type JwtPayload = {
  sub: string;
  role?: Role | null;
  email?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** サインアップ（User.role は運営のみ。一般ユーザーは role=null） */
  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('このメールアドレスは既に登録されています');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: null, //一般ユーザーは role=null（運営のみ role を持つ）
      },
      select: { id: true, email: true, role: true },
    });

    const access_token = await this.signAccessToken(user.id, user.role, user.email);
    const refresh_token = await this.signRefreshToken(user.id, user.role, user.email);

    return {
      access_token,
      refresh_token,
      user,
    };
  }

  async login(dto: { email: string; password: string }) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const access_token = await this.signAccessToken(user.id, user.role, user.email);
    const refresh_token = await this.signRefreshToken(user.id, user.role, user.email);

    return {
      access_token,
      refresh_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async rotateAccessToken(refresh_token: string) {
    try {
      const payload = (await this.jwt.verifyAsync(refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET!,
      })) as JwtPayload;

      // role は無くてもOK（一般ユーザーは null）
      return this.signAccessToken(payload.sub, payload.role ?? null, payload.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async signAccessToken(
    userId: number | string,
    role?: Role | null,
    email?: string,
  ) {
    const payload: JwtPayload = {
      sub: String(userId),
      role: role ?? null,
      email,
    };

    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_SECRET as string,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    } as any);
  }

  private async signRefreshToken(
    userId: number | string,
    role?: Role | null,
    email?: string,
  ) {
    const payload: JwtPayload = {
      sub: String(userId),
      role: role ?? null,
      email,
    };

    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET as string,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    } as any);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!ok) throw new ForbiddenException('現在のパスワードが違います');

    const hashed = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashed },
    });

    return { success: true };
  }
}
