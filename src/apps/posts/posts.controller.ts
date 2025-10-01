import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  // ログイン任意。トークンがあれば req.user に入る、無ければ null
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req) {
    const userId: string | undefined = req.user?.sub;
    return this.posts.findOne(id, userId);
  }
}
