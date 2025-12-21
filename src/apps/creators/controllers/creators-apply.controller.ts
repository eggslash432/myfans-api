// api/src/apps/creators/controllers/creators-apply.controller.ts

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreatorsService } from '../creators.service';
import { CreateCreatorDto } from '../dto/create-creator.dto';
import { CreatorsControllerHelpers } from './creators.controller-helpers';

@Controller('creators')
export class CreatorsApplyController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private readonly helpers: CreatorsControllerHelpers,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('apply')
  async applyCreator(@Req() req: any, @Body() dto: CreateCreatorDto) {
    const userId = this.helpers.getUserIdOrThrow(req);
    return this.creatorsService.applyCreator(userId, dto);
  }
}
