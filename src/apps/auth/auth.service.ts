import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

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

  private async signRefreshToken(userId: number | string) {
    const payload: { sub: string } = { sub: String(userId) };
    return this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET as string,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    } as any);
  }

}
