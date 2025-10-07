import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard'
import { CurrentUser } from '../../../auth/current-user.decorator'
import { UsersMeSummaryService } from './users-me-summary.service'

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersMeSummaryController {
  constructor(private readonly service: UsersMeSummaryService) {}

  @Get('summary')
  async getSummary(@CurrentUser() user: any) {
    // JWT のペイロードに合わせて柔軟に拾う
    const userId: string | undefined = user?.id ?? user?.userId ?? user?.sub
    if (!userId) {
      // デバッグしやすいように実体もログへ
      console.error('[users/me/summary] req.user is undefined or has no id:', user)
      throw new UnauthorizedException('no_user_in_token')
    }
    return this.service.getSummary(userId)
  }
}
