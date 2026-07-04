import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.guard';

/**
 * AdminGuard — resolves a Bearer session token AND requires the identity to be a
 * platform super-admin (from platform_admins). Guards the platform admin portal:
 * a valid token without platform-admin rights is rejected with 403.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('missing bearer token');
    let ctx;
    try {
      ctx = await this.auth.authenticate(token);
    } catch {
      throw new UnauthorizedException('invalid session');
    }
    if (!ctx.isPlatformAdmin) {
      throw new ForbiddenException('platform admin required');
    }
    req.authCtx = ctx;
    return true;
  }
}
