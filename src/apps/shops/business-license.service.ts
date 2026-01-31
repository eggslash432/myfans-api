// api/src/apps/shops/business-license.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessLicenseService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadForMyShop(shopId: string, fileKey: string) {
    // 最短：アップロードされたキーを保存し、status を pending に戻す
    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        businessLicenseFileKey: fileKey,
        businessLicenseStatus: 'pending' as any,
        businessLicenseCheckedAt: null,
        businessLicenseCheckedBy: null,
      },
    });
  }

  async adminGet(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        businessLicenseFileKey: true,
        businessLicenseStatus: true,
        businessLicenseCheckedAt: true,
        businessLicenseCheckedBy: true,
      },
    });
    if (!shop) throw new NotFoundException('店舗が見つかりません');
    return shop;
  }

  async adminApprove(shopId: string, adminUserId: string) {
    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        businessLicenseStatus: 'approved' as any,
        businessLicenseCheckedAt: new Date(),
        businessLicenseCheckedBy: adminUserId,
      },
    });
  }

  async adminReject(shopId: string, adminUserId: string, reason?: string) {
    // reason はShopに持たせても別テーブルでもOK。最短はログに残す運用
    if (reason && reason.length > 500) throw new BadRequestException('reasonが長すぎます');

    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        businessLicenseStatus: 'rejected' as any,
        businessLicenseCheckedAt: new Date(),
        businessLicenseCheckedBy: adminUserId,
      },
    });
  }

  async getStatus(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        businessLicenseStatus: true,
        businessLicenseFileKey: true,
        businessLicenseCheckedAt: true,
        businessLicenseCheckedBy: true,
      },
    });

    if (!shop) {
      return {
        shopId,
        status: 'shop_not_found',
      };
    }

    return {
      shopId,
      businessLicenseStatus: shop.businessLicenseStatus,
      hasFile: !!shop.businessLicenseFileKey,
      checkedAt: shop.businessLicenseCheckedAt,
      checkedBy: shop.businessLicenseCheckedBy,
    };
  }
}
