import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserJwt } from 'src/shared/types';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req) {
    return this.usersService.findMe(req.user.id);
  }

  @Patch('me')
  updateMe(
    @Req() req,
    @Body() body: { name?: string }
  ) {
    return this.usersService.updateMe(req.user.id, body);
  }

  @Patch('password')
  changePassword(
    @Req() req,
    @Body() body: { currentPassword: string; newPassword: string }
  ) {
    return this.usersService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    );
  }
}