// api/src/apps/shops/business-license.controller.ts

import { Body, Controller, Get, Param, Post as HttpPost, Req, UseGuards } from '@nestjs/common';
import { BusinessLicenseService } from './business-license.service';
import { RejectBusinessLicenseDto } from './dto/business-license.dto';

// TODO: 既存に合わせて差し替え
class JwtAuthGuard {}
class AdminGuard {}

@Controller()
export class BusinessLicenseController {
  constructor(private readonly svc: BusinessLicenseService) {}

  /**
   * ここは本来 multipart/file upload だが、既存の upload API がある想定。
   * 最短：フロントが先にS3等へアップして fileKey を投げる方式。
   */
  @UseGuards(JwtAuthGuard as any)
  @HttpPost('shops/me/business-license')
  upload(@Req() req: any, @Body() body: { fileKey: string }) {
    const shopId = req.user?.shopId; // プロジェクトのJWTに合わせて変更
    if (!shopId) throw new Error('shopId not found');
    if (!body?.fileKey) throw new Error('fileKey required');
    return this.svc.uploadForMyShop(shopId, body.fileKey);
  }

  /**
   * 営業許可書の提出状況／審査状況を返す（D-5/D-7導線用）
   * - ★ ShopLicenseApprovedGuard は付けない（未承認でも入れる必要がある）
   */
  @UseGuards(JwtAuthGuard as any)
  @Get('shops/me/business-license/status')
  status(@Req() req: any) {
    const shopId = req.user?.shopId;
    if (!shopId) {
      return {
        shopId: null,
        status: 'no_shop',
      };
    }
    return this.svc.getStatus(shopId);
  }

  @UseGuards(AdminGuard as any)
  @Get('admin/shops/:shopId/business-license')
  adminGet(@Param('shopId') shopId: string) {
    return this.svc.adminGet(shopId);
  }

  @UseGuards(AdminGuard as any)
  @HttpPost('admin/shops/:shopId/business-license/approve')
  adminApprove(@Req() req: any, @Param('shopId') shopId: string) {
    const adminUserId = req.user?.id;
    if (!adminUserId) throw new Error('admin user not found');
    return this.svc.adminApprove(shopId, adminUserId);
  }

  @UseGuards(AdminGuard as any)
  @HttpPost('admin/shops/:shopId/business-license/reject')
  adminReject(
    @Req() req: any,
    @Param('shopId') shopId: string,
    @Body() dto: RejectBusinessLicenseDto,
  ) {
    const adminUserId = req.user?.id;
    if (!adminUserId) throw new Error('admin user not found');
    return this.svc.adminReject(shopId, adminUserId, dto.reason);
  }
}
