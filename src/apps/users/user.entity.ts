export type Role = 'fan' | 'creator';

export class User {
  id: string;               // uuid想定
  email: string;
  passwordHash: string;
  role: Role;
  nickname?: string;
  createdAt: Date;
}
