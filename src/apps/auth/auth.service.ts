import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // サインアップ（必要ならUsersService経由でもOK）
  async signup(dto: SignupDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,                 // ← スキーマに合わせて
        role: dto.role ?? 'fan',      // ← スキーマに合わせて
        isActive: true,             // 任意
      },
      select: { id: true, email: true, role: true },
    });
    return { user };
  }

  // ログイン：200 + JSON で access_token を返す
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // スキーマ上のパスワード列名に合わせる（例: passwordHash / password など）
    const ok = await bcrypt.compare(dto.password, (user as any).passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const access_token = await this.sign(user.id.toString(), user.email, user.role);
    // password を外して返す
    const { password, passwordHash, ...safeUser } = user as any;
    return { user: safeUser, access_token };
  }

  async me(payload: { sub: string; email: string; role: string }) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }

  private async sign(sub: string, email: string, role: string) {
    return this.jwt.signAsync({ sub, email, role }, { expiresIn: '1h' });
  }
}
