import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { type Response, type Request } from 'express';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SignupDto } from './dto/signup.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }  

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, refresh_token, user } =
      await this.authService.login(dto);

    // Cookieをセット
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // 本番はtrueに
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30日
      path: '/auth',
    });

    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  @Post('refresh')
  async refresh(@Req() req: Request) {
    const cookies = (req as any).cookies as Record<string, string> | undefined;
    const rt = cookies?.['refresh_token'];
    if (!rt) throw new UnauthorizedException('No refresh token');

    const access_token = await this.authService.rotateAccessToken(rt);
    return { access_token };
  }

  // ★ 追加：現在ログイン中のユーザー情報
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    // JwtStrategy で付与しているpayloadから返却（sub/email/role 等）
    const u = req.user; // { sub, email?, role? } 等
    return { id: u.sub, email: u.email, role: u.role };
  }
}
