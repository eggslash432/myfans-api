// api/src/apps/help/help.controller.ts

import { Controller, Get, Param } from '@nestjs/common';
import { HelpService } from './help.service';

@Controller('help')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Get('articles')
  list() {
    return this.help.listPublic();
  }

  @Get('articles/:slug')
  get(@Param('slug') slug: string) {
    return this.help.getPublicBySlug(slug);
  }
}
