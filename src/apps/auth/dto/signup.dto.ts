// src/apps/auth/dto/signup.dto.ts

import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail() email: string;

  @IsString() 
  @MinLength(8)
  password: string;
}
