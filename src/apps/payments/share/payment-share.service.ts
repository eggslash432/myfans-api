// api/src/apps/payments/share/payment-shre.service.ts

import { Injectable } from "@nestjs/common";
import { FeeSetting } from "@prisma/client";
import { PrismaService } from "src/apps/prisma/prisma.service";

@Injectable()
export class PaymentShareService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeeSetting(): Promise<FeeSetting> {
    const fs = await this.prisma.feeSetting.findFirst();
    if (fs) return fs;

    return {
      id: 0,
      managerPercent: 20,
      shopPercent: 10,
      creatorPercent: 70,
      updatedAt: new Date(),
    } as FeeSetting;
  }

  split(totalJpy: number, setting: FeeSetting) {
    const manager = Math.floor((totalJpy * (setting.managerPercent ?? 0)) / 100);
    const shop = Math.floor((totalJpy * (setting.shopPercent ?? 0)) / 100);
    const creator = totalJpy - manager - shop;

    return {
      managerAmountJpy: manager,
      shopAmountJpy: shop,
      creatorAmountJpy: creator,
    };
  }
}
