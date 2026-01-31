// api/src/site-pages/site-pages.controller.ts
import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { SitePagesService } from "./site-pages.service";


@Controller("site-pages")
export class SitePagesController {
  constructor(private readonly service: SitePagesService) {}

  @Get(":slug")
  async getBySlug(@Param("slug") slug: string) {
    const page = await this.service.getPublishedBySlug(slug);
    if (!page) throw new NotFoundException("Page not found");
    return page;
  }
}
