// api/src/apps/storage/storage.module.ts

import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  providers: [
    S3Service,
    MediaStorageService,
  ],
  exports: [
    MediaStorageService,
  ], // ✅ 他モジュールに公開
})
export class StorageModule {}
