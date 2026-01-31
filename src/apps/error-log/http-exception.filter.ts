// api/src/apps/error-log/http-exception.filter.ts

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorLogService } from './error-log.service';
import { getIp, getUa, maskDeep } from './error-log.util';

@Catch()
export class HttpErrorLogFilter implements ExceptionFilter {
  constructor(private readonly errorLog: ErrorLogService) {}

  async catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const isHttp = exception instanceof HttpException;

    const statusCode = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttp
      ? (exception.getResponse() as any)?.message ?? exception.message
      : exception?.message ?? 'Internal Server Error';

    const name = exception?.name ?? null;
    const stack = exception?.stack ?? null;

    // ✅ ここが最小の方針：
    // 500系は必ず保存。必要なら 4xx も保存する。
    const shouldLog =
      statusCode >= 500 ||
      (statusCode >= 400 && statusCode !== 401 && statusCode !== 403); // 好みで調整

    if (shouldLog) {
      const user = (req as any).user as { id?: string; role?: any } | undefined;

      await this.errorLog.write({
        level: statusCode >= 500 ? 'error' : 'warn',
        message: String(message),
        name,
        stack,
        statusCode,
        method: req.method,
        path: req.originalUrl ?? req.url,
        userId: user?.id ?? null,
        role: user?.role ?? null,
        ip: getIp(req),
        userAgent: getUa(req),
        meta: {
          query: maskDeep(req.query),
          body: maskDeep((req as any).body),
          params: maskDeep((req as any).params),
        },
      });
    }

    // 既存のレスポンスを崩さない（最小）
    if (isHttp) {
      const body = exception.getResponse();
      res.status(statusCode).json(typeof body === 'string' ? { message: body } : body);
    } else {
      res.status(statusCode).json({ message: 'Internal Server Error' });
    }
  }
}
