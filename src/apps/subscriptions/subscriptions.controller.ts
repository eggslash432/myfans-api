import { Controller, Post, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/apps/auth/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Post(':id/cancel')
  async cancel(@Req() req, @Param('id') id: string) {
    const userId: string = req.user.id ?? req.user.sub;
    return this.subs.cancelSubscription(userId, id);
  }
}

