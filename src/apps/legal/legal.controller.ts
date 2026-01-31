// api/src/apps/legal/legal.controller.ts

import { Body, Controller, Get, Post as HttpPost, Query, Req, UseGuards } from '@nestjs/common';
import { LegalService } from './legal.service';
import { AgreeLegalDto, LegalDocumentTypeDto } from './dto/legal.dto';

// TODO: 既存のJWTガードへ差し替え
class JwtAuthGuard {}

@Controller()
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('legal/latest')
  latest(@Query('type') type: LegalDocumentTypeDto) {
    return this.legal.getLatest(type);
  }

  @UseGuards(JwtAuthGuard as any)
  @HttpPost('legal/agree')
  agree(@Req() req: any, @Body() dto: AgreeLegalDto) {
    const userId = req.user?.id;
    const ip = req.ip;
    if (!userId) throw new Error('user not found');
    return this.legal.agree(userId, ip, dto);
  }

  @UseGuards(JwtAuthGuard as any)
  @Get('me/legal/agreements')
  agreements(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new Error('user not found');
    return this.legal.listAgreements(userId);
  }
}
