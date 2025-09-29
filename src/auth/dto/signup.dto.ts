import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail() email: string;

  @IsString() @MinLength(8)
  password: string;

  @IsIn(['fan', 'creator'])
  role: 'fan' | 'creator';
}
