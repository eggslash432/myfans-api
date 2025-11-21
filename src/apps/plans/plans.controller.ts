import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingInterval } from '@prisma/client';
import { CreatorOnlyGuard } from '../access-control/creator-only.guard';
import { CreatorHelper } from '../helpers/creator.helper';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)   // クリエイターのみ
  async create(@Body() dto: CreatePlanDto, @Req() req) {

    const userId = req.user?.sub;
    if (!userId) throw new BadRequestException('未ログインです');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId).catch(() => null);
    if (!creatorId) throw new ForbiddenException('クリエイター登録がありません');  

    try{
      const plan = this.prisma.plan.create({
        data: {
          creatorId: req.user.userId,
          name: dto.name,
          priceJpy: dto.priceJpy,     // 月額
          billingInterval: dto.billingInterval ?? BillingInterval.month, 
          isActive: true,
          creator: {connect: { userId: userId }},
          description: dto.description ?? undefined,
        },
        select:{
          id: true, 
          name: true, 
          priceJpy: true, 
          isActive: true
        }
      });
      return plan;
    }catch(e: any){
      const code = e?.code;
      // ここで“500の正体”を表に出す
      console.error('[POST /plans] create error:', { msg: e?.message, code: code, meta: e?.meta, dto, creatorId });
      if (code === 'P2003') {
        // 外部キー（creatorId）が不整合
        throw new BadRequestException('作成に失敗：Creator が見つかりません（外部キー制約）');
      }
      if (code === 'P2002') {
        // 一意制約（もし name に unique が付いている場合）
        throw new BadRequestException('同名のプランが既に存在します');
      }
      // 型不一致など
      throw new BadRequestException(e?.message ?? '作成に失敗しました');
    }  
  }  
    

  @Get()
  async findByCreator(@Query('creatorId') creatorId: string) {
    if (!creatorId) throw new BadRequestException('creatorId is required');
    return this.prisma.plan.findMany({
      where: { creatorId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, priceJpy: true, isActive: true },
    });
  } 

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Req() req) {
    const userId = req.user.sub;
    return this.plans.findByCreator(userId);
  }

  @Get()
  async myPlans(@Req() req: any) {
    const creatorId = await this.creatorHelper.getMyCreatorId(req.user.sub);
    return this.prisma.plan.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, priceJpy: true, isActive: true },
    });
  }  
}
