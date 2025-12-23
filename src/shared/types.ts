// src/shared/types.ts

import { PaymentKind, Role } from "@prisma/client";

export type UserJwt = {
  id: string;               // userId
  role: Role;
  email?: string;
};

export type JwtPayload = { 
  sub: string; 
  email: string; 
  role: string;
  creatorId: string;
}

// 「user を持つ Request 型」を自前で定義
export type RequestWithUser = {
  user?: {
    id: string;
    role: Role;
  };
} & Request;

export type CreatePaymentWithShareArgs = {
  userId: string;
  creatorId: string;
  planId: string | null;
  postId: string | null;
  amountJpy: number;
  kind: PaymentKind;          // 'subscription' | 'one_time' など（あなたの Prisma に合わせる）
  externalTxId: string;       // invoice.id / payment_intent.id を入れる
};

export type ResolveAction = 'reviewed' | 'dismissed';

export type SalesSummaryRes = {
  range: 'today' | 'month' | 'all';
  gross: number;         // 店舗取り分合計（Transfer.kind=shop）
  platformFee: number;   // プラットフォーム取り分合計（同じ paymentId 群の Transfer.kind=platform）
  net: number;           // 入金対象（=gross）
  transactions: number;  // 取引数（Transfer.kind=shop の件数）
};