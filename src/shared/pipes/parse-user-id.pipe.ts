// api/src/shared/pipes/parse-user-id.pipe.ts

import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseUserIdPipe implements PipeTransform<string, string> {
  private readonly uuidRe =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  // prisma cuid() をざっくり許容（必要なら厳格化）
  private readonly cuidRe = /^c[a-z0-9]{9,29}$/;

  transform(value: string) {
    if (this.uuidRe.test(value) || this.cuidRe.test(value)) return value;

    // “存在しない”扱いにしたいので 404
    throw new NotFoundException('クリエイターが見つかりません');
  }
}
