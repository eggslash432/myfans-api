//api/src/apps/auth/jwt.strategy.ts

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
      ignoreExpiration: false,
    });
  }

  async validate(
    payload: { 
      sub: string; 
      email: string; 
      role: string;
      creatorId: string;
    }
  ) {
    console.log('JWT payload in validate:', payload);

    // sub を id にマッピングして req.user に載せる
    return { 
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      creatorId: payload.creatorId,
    };
  }
}
