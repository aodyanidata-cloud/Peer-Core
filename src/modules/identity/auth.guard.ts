import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';

export interface AuthedRequest {
  headers: Record<string, string | undefined>;
  authCtx?: AuthContext;
}

/**
 * AuthGuard — resolves a Bearer session token to an AuthContext and attaches it
 * to the request. Completes the auth story into HTTP: controllers behind this
 * guard get a verified identity; the tenant is then derived from that identity's
 * DB memberships (never from the client).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('missing bearer token');
    try {
      req.authCtx = await this.auth.authenticate(token);
      return true;
    } catch {
      throw new UnauthorizedException('invalid session');
    }
  }
}
