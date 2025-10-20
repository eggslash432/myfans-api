import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getMyCreatorId } from '../helpers/creator';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Req() req, @Body() dto: CreatePlanDto) {
    const userId = req.user.sub;
    return this.plans.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Req() req) {
    const userId = req.user.sub;
    return this.plans.findByCreator(userId);
  }

  @Get()
  async myPlans(@Req() req: any) {
    const creatorId = await getMyCreatorId(this.prisma, req.user.sub);
    return this.prisma.plan.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, priceJpy: true, isActive: true },
    });
  }  
}
