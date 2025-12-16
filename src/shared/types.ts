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