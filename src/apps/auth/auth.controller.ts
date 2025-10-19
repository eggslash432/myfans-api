import { Body, Controller, Get, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 未認証OK
  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  // ★ここが重要：204を返さず 200 + JSON（access_token 含む）を返す
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    const { user, access_token } = await this.auth.login(dto);
    return {
      access_token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user);
  }
}
