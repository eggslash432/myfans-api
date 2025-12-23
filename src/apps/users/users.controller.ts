// api/src/apps/users/users.controller.ts

import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: any) {
    const userId = String(req.user?.id ?? '');
    if (!userId) throw new UnauthorizedException('ログインが必要です');
    return this.usersService.findMe(userId);
  }

  @UseGuards(JwtAuthGuard) // ✅ これが無かった
  @Patch('me')
  updateMe(@Req() req: any, @Body() body: { name?: string }) {
    const userId = String(req.user?.id ?? '');
    if (!userId) throw new UnauthorizedException('ログインが必要です');
    return this.usersService.updateMe(userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(@Req() req, @Body() body: any) {
    const currentPassword =
      body.currentPassword ?? body.current ?? body.oldPassword ?? body.password;
    const newPassword =
      body.newPassword ?? body.next ?? body.new ?? body.passwordNew;

    return this.usersService.changePassword(req.user.id, currentPassword, newPassword);
  }
}
