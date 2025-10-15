import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator((_, ctx: ExecutionContext) => {
  const u = ctx.switchToHttp().getRequest().user;
  return u ? { id: u.id ?? u.sub, email: u.email, role: u.role } : null;
});
