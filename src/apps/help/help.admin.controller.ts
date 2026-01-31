//api/src/apps/help/help.admin.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { HelpService } from './help.service';
import { CreateHelpArticleDto, UpdateHelpArticleDto } from './dto/help-article.dto';

// TODO: あなたのプロジェクトの管理者ガードに差し替え
class AdminGuard {}

@Controller('admin/help')
@UseGuards(AdminGuard as any)
export class HelpAdminController {
  constructor(private readonly help: HelpService) {}

  @Get('articles')
  list() {
    return this.help.listAdmin();
  }

  @Post('articles')
  create(@Body() dto: CreateHelpArticleDto) {
    return this.help.createAdmin(dto);
  }

  @Patch('articles/:id')
  update(@Param('id') id: string, @Body() dto: UpdateHelpArticleDto) {
    return this.help.updateAdmin(id, dto);
  }

  @Delete('articles/:id')
  remove(@Param('id') id: string) {
    return this.help.deleteAdmin(id);
  }
}
