// src/apps/core/media/media.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { S3Service } from '../s3/s3.service';

class CreatePresignDto {
  fileName: string;
  contentType: string;
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly s3: S3Service) {}

  @Post('presign')
  async presign(@Body() dto: CreatePresignDto) {
    return this.s3.createUploadUrl(dto);
  }
}
