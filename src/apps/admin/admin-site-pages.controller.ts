// api/src/admin/admin-site-pages.controller.ts
import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { SitePagesService } from "../site-pages/site-pages.service";

@Controller("admin/site-pages")
export class AdminSitePagesController {
  constructor(private readonly service: SitePagesService) {}

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.service.getBySlug(slug);
  }

  @Put(":slug")
  update(
    @Param("slug") slug: string,
    @Body() body: { title?: string; body?: string; published?: boolean }
  ) {
    return this.service.upsertBySlug(slug, body);
  }
}
