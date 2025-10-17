import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')  // ← ガードなし（未認証OK）
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post('login')   // ← ガードなし（未認証OK）
  async login(@Body() dto: LoginDto) {
    // ユーザー確認 & パスワード照合は service 側へ
    const { user, access_token } = await this.auth.login(dto);
    // ★ 必ず access_token を JSON で返す（フロントはこれを保存する）
    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  @UseGuards(JwtAuthGuard)  // ← /me のみ保護
  @ApiBearerAuth()
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user);
  }
}

