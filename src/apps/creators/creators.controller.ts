import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { CreatorsService } from './creators.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCreatorDto } from './dto/create-creator.dto';

@Controller('creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  // POST /creators
  @UseGuards(JwtAuthGuard)
  @Post()
  async applyAsCreator(@Request() req, @Body() dto: CreateCreatorDto) {
    console.log('req.user =', req.user); // ← デバッグ用
    // req.user は JWT から取れる（id, email, roleなど）
    return this.creatorsService.applyCreator(req.user.sub, dto);
  }
}
