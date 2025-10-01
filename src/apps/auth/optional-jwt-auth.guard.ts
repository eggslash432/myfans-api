import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // トークンが無い/無効でも 401 にせず、user を null にする
  handleRequest(err: any, user: any) {
    if (err || !user) return null;
    return user;
  }
}
