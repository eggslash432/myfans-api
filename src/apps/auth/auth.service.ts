import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // src/apps/auth/auth.service.ts（抜粋・追加）
  async signup(dto: SignupDto) {
    const exists = await this.users.findByEmail(dto.email);
    if (exists) throw new BadRequestException('既に登録済みのメールです');

    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create(dto.email, hash, dto.role as Role);

    // ★ ここが重要：Creator と Profile を保証
    if (user.role === 'creator') {
      await this.prisma.creator.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, publicName: '', isListed: false },
      });
    }
    await this.prisma.profile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, displayName: dto.email.split('@')[0] },
    });

    const access_token = await this.sign(user.id, user.email, user.role);
    const { passwordHash, ...safeUser } = user;
    return { user: safeUser, access_token };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: user.id, email: user.email, role: user.role };
    const access_token = await this.jwt.signAsync(payload, { expiresIn: '7d' });

    // omit sensitive fields when returning
    const { passwordHash, ...safeUser } = user;
    return { user: safeUser, access_token };
  }

  async me(payload: { sub: string; email: string; role: string }) {
    // 必要に応じてDBから最新情報を取得して返しても良い
    return { id: payload.sub, email: payload.email, role: payload.role };
  }

  private async sign(sub: string, email: string, role: string) {
    return this.jwt.signAsync({ sub, email, role });
  }
}
