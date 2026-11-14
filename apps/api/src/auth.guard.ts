import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionUser } from './session';

export interface RequestWithSession {
  headers: { authorization?: string; 'x-outlet'?: string | string[] };
  session: SessionUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const outlet = request.headers['x-outlet'];
    request.session = await this.auth.sessionFromHeader(request.headers.authorization, Array.isArray(outlet) ? outlet[0] : outlet);
    return true;
  }
}
