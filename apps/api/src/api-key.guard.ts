import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service';

export interface RequestWithApiCompany extends Request {
  apiCompany: { id: string; name: string };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiCompany>();
    const header = String(request.headers.authorization || '');
    const direct = String(request.headers['x-api-key'] || '').trim();
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const token = (bearer.startsWith('hrms_') ? bearer : direct.startsWith('hrms_') ? direct : '').trim();
    request.apiCompany = await this.settings.resolveCompanyByApiKey(token);
    return true;
  }
}