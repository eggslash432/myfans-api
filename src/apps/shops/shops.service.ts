// api/src/apps/shops/shops.service.ts（例）
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import Stripe from "stripe";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ShopsService {
  private stripe: Stripe;
  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.stripe = new Stripe(this.config.get<string>("STRIPE_SECRET_KEY")!, {});
  }

  async createShop(name: string) {
    return this.prisma.shop.create({ data: { name } });
  }

  async createStripeAccountForShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new Error("shop not found");

    const account = await this.stripe.accounts.create({
      type: "express",
      country: "JP",
      business_type: "company",
      capabilities: {
        transfers: { requested: true },
      },
    });

    await this.prisma.shop.update({
      where: { id: shopId },
      data: { stripeAccountId: account.id },
    });

    return account.id;
  }
}
