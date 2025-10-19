import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignupDto } from './dto/signup.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  /** サインアップ実装 */
  async signup(dto: SignupDto) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('このメールアドレスは既に登録されています');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role;

    // ユーザー作成
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,     // ← Prismaのカラム名に合わせて。もし `password` なら変更してください
        role,             // スキーマに role が無い場合は削ってOK（/auth/me で推定でも可）
      },
      select: { id: true, email: true, role: true },
    });

    // クリエイター希望なら Creator 行も同時に用意（userId が 1:1 Unique）
    if (role === 'creator') {
      await this.prisma.creator.create({
        data: {
          userId: user.id,
          publicName: email.split('@')[0], // 初期値。プロフィール編集で上書き想定
        },
      });
    }

    const access_token = await this.signAccessToken(user.id, user.role as Role, user.email);
    const refresh_token = await this.signRefreshToken(user.id, user.role as Role, user.email);

    return {
      access_token,
      refresh_token,
      user: { id: user.id, email: user.email, role: user.role ?? (role as Role) },
    };
  }  

  async login(dto: { email: string; password: string }) {
    // 仮のユーザー検証（本来はDB照合）
    const user = { id: 1, email: dto.email, role: 'creator' };

    // ここでパスワード検証を入れる
    // const valid = await bcrypt.compare(dto.password, user.passwordHash);
    // if (!valid) throw new UnauthorizedException('Invalid credentials');

    const access_token = await this.signAccessToken(user.id, user.role, user.email);
    const refresh_token = await this.signRefreshToken(user.id);

    return { access_token, refresh_token, user };
  }

  async rotateAccessToken(refresh_token: string) {
    try {
      const payload = await this.jwt.verifyAsync(refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET!,
      });
      return this.signAccessToken(payload.sub, payload.role);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async signAccessToken(userId: number | string, role?: string, email?: string) {
    const payload: { sub: string; role?: string; email?: string} = {
      sub: String(userId),   // ← ここが重要
      role,
      email,
    };
    return this.jwt.signAsync(payload, {
      // ↓② と合わせて読んでください
      secret: process.env.JWT_SECRET as string,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    } as any); // ← secret を options に入れる場合は any で逃がすのが一番早い
  }

  private async signRefreshToken(userId: number | string, role?: Role, email?: string) {
    const payload: { sub: string; role?: Role; email?: string } = {
       sub: String(userId) ,
       role,
       email,
    };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET as string,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    } as any);
  }

}
