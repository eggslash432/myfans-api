export type UserJwt = {
  sub: string;
  role: 'fan' | 'creator' | 'admin';
  email?: string;
};