import { Controller, Get, Patch, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin/creators')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminCreatorsController {
  constructor(private prisma: PrismaService) {}

  // 未掲載（審査待ち）一覧: GET /admin/creators?status=pending
  @Get()
  async listPending(): Promise<{ items: any[] }> {
    const rows = await this.prisma.creator.findMany({
      where: { isListed: false, user: { isActive: true } },
      select: {
        userId: true,
        publicName: true,
        createdAt: true,
        isListed: true,
        user: { 
          select: { 
            email: true, 
            role: true,
            profile:{
              select: {
                bio: true
              }
            }
          } 
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const items = rows.map(r => ({
      id: r.userId,
      displayName: r.publicName,
      email: r.user.email,
      role: r.user.role,
      bio: r.user.profile?.bio ?? '',
      createdAt: r.createdAt,
      isListed: r.isListed,
    }));
    return { items };
  }

  // 掲載切替: PATCH /admin/creators/:userId/listing
  @Patch(':userId/listing')
  async setListing(
    @Param('userId') userId: string,
    @Body() body: { isListed?: boolean }
  ) {
    if (typeof body?.isListed !== 'boolean') {
      throw new BadRequestException('isListed(boolean) を指定してください');
    }
    const updated = await this.prisma.creator.update({
      where: { userId },
      data: { isListed: body.isListed },
      select: { userId: true, isListed: true },
    });
    return { id: updated.userId, isListed: updated.isListed };
  }
}
