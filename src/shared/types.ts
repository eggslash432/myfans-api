import { Role } from "@prisma/client";

// src/shared/types.ts
export type UserJwt = {
  id: string;               // userId
  role: Role;
  email?: string;
};

// 「user を持つ Request 型」を自前で定義
export type RequestWithUser = {
  user?: {
    id: string;
    role: Role;
  };
} & Request;