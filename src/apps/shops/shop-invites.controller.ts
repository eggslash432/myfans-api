// api/src/apps/shops/shop-invites.controller.ts

import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Request } from "express";
import { randomBytes } from "crypto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

function requireUserId(req: Request) {
  const userId = String((req as any).user?.id ?? "");
  if (!userId) throw new ForbiddenException("ログインが必要です");
  return userId;
}

@UseGuards(JwtAuthGuard)
@Controller("shop")
export class ShopInvitesController {
  constructor(private readonly prisma: PrismaService) {}

  // owner/adminが招待コード作る
  @Post("invites")
  async createInvite(
    @Req() req: Request,
    @Body()
    body: {
      role?: "owner" | "admin" | "staff";
      expiresAt?: string; // ISO
    },
  ) {
    const userId = requireUserId(req);

    // ✅ 自分が所属するshopを特定（あなたの実装と同じ前提）
    const member = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { shopId: true, role: true },
    });
    if (!member) throw new ForbiddenException("Shop に所属していません");

    if (member.role !== "owner" && member.role !== "admin") {
      throw new ForbiddenException("招待コードを作成できません");
    }

    const code = randomBytes(6).toString("base64url"); // だいたい8文字前後
    const invite = await this.prisma.shopInvite.create({
      data: {
        shopId: member.shopId,
        code,
        role: body.role ?? "staff",
        createdBy: userId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      select: { code: true, role: true, expiresAt: true },
    });

    return invite;
  }

  // staffが招待コードで参加
  @Post("join")
  async join(
    @Req() req: Request,
    @Body() body: { code: string },
  ) {
    const userId = requireUserId(req);

    const invite = await this.prisma.shopInvite.findUnique({
      where: { code: body.code },
      select: { shopId: true, role: true, expiresAt: true },
    });
    if (!invite) throw new ForbiddenException("招待コードが無効です");
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException("招待コードの期限が切れています");
    }

    // 既に所属済みならそのまま返す（冪等）
    const existing = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { id: true, shopId: true, role: true },
    });
    if (existing) return { ok: true, member: existing, already: true };

    const member = await this.prisma.shopMember.create({
      data: {
        userId,
        shopId: invite.shopId,
        role: invite.role, // staffが基本
      },
      select: { id: true, shopId: true, role: true },
    });

    return { ok: true, member, already: false };
  }
}
