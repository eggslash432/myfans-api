import { Controller, Post, Req, Headers } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhook')
  async webhook(@Req() req, @Headers('stripe-signature') sig?: string) {
    // 署名検証を入れるならここで（省略可／テスト中はOFFでも可）
    return this.payments.handleWebhook(req.rawBody ?? req.body, sig);
  }
}
