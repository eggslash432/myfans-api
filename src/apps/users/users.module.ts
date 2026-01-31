import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    MeModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService, 
    PrismaService,
  ],
  exports: [UsersService],
})
export class UsersModule {}

