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
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)  // ← /me のみ保護
  @ApiBearerAuth()
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user);
  }
}

