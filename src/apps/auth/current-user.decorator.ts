import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const CurrentUser = createParamDecorator((_, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest()
  console.log('[CurrentUser] req.user =', req.user)  // デバッグ用
  return req.user
})
