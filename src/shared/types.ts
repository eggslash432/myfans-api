// src/shared/types.ts

import { Role } from "@prisma/client";

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