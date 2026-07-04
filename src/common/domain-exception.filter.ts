import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Domain error class names that carry a stable string `code`. */
const DOMAIN_ERRORS = new Set([
  'OrderError',
  'PaymentError',
  'DispatchError',
  'AuthError',
  'ReservationError',
  'ReviewError',
  'ValidationError',
]);

/** code → HTTP status. Anything unlisted from a domain error is a 400. */
const STATUS_FOR: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  unknown_tool: 404,
  invalid_phone: 400,
  bad_item: 400,
  bad_modifier: 400,
  bad_promo: 400,
  bad_schedule: 400,
  invalid_otp: 400,
  otp_locked: 429,
  unavailable: 409,
  closed: 409,
  below_minimum: 409,
  slot_taken: 409,
  over_capacity: 409,
  confirmation_required: 409,
  illegal_transition: 409,
  conflict: 409,
  order_not_complete: 409,
  declined: 402,
};

const NAME_FOR_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'payment_required',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'too_many_requests',
};

/**
 * DomainExceptionFilter — one consistent error envelope for the whole API
 * (Technical-Decisions-Register #23 / API-Design-Conventions §5). Maps domain
 * error `code`s to HTTP status + `{ error: { code, message } }`, normalizes Nest
 * HttpExceptions into the same shape, and never leaks internals on a 500.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
      void reply.status(status).send({
        error: {
          code: NAME_FOR_STATUS[status] ?? 'error',
          message: Array.isArray(message) ? message.join(', ') : message,
        },
      });
      return;
    }

    const code = (exception as { code?: string })?.code;
    const name = (exception as { name?: string })?.name;
    if (code && name && DOMAIN_ERRORS.has(name)) {
      const status = STATUS_FOR[code] ?? 400;
      void reply
        .status(status)
        .send({ error: { code, message: (exception as Error).message } });
      return;
    }

    console.error('unhandled exception:', exception);
    void reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'internal server error' } });
  }
}
