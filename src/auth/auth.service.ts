import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const exists = await this.users.findByEmail(dto.email);
    if (exists) throw new BadRequestException('既に登録済みのメールです。');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.users.create(dto.email, passwordHash, dto.role);

    const token = await this.sign(user.id, user.email, user.role);
    return {
      access_token: token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('メールまたはパスワードが不正です。');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('メールまたはパスワードが不正です。');

    const token = await this.sign(user.id, user.email, user.role);
    return {
      access_token: token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async me(payload: { sub: string; email: string; role: string }) {
    // 必要に応じてDBから最新情報を取得して返しても良い
    return { id: payload.sub, email: payload.email, role: payload.role };
  }

  private async sign(sub: string, email: string, role: string) {
    return this.jwt.signAsync({ sub, email, role });
  }
}
