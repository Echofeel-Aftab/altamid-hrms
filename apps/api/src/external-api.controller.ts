import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ApiKeyGuard, RequestWithApiCompany } from './api-key.guard';
import { ExternalApiService } from './external-api.service';

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Altamid HRMS External API', version: '1.0.0' },
  servers: [{ url: '/v1/external' }],
  paths: {
    '/health/me': { get: { summary: 'Company identity' } },
    '/employees': { get: { summary: 'Employee directory (paginated)' } },
    '/leave/balances': { get: { summary: 'Leave balances for one employee code' } },
    '/enquiries/leads': { post: { summary: 'Create hiring lead' } },
  },
};

@Controller('v1/openapi')
export class OpenApiController {
  @Get()
  spec() {
    return SPEC;
  }
}

@Controller('v1/external')
@UseGuards(ApiKeyGuard)
export class ExternalRoutesController {
  constructor(private readonly external: ExternalApiService, private readonly auth: AuthService) {}

  private pace(request: Request, companyId: string): void {
    const ip = request.socket.remoteAddress || 'local';
    this.auth.pace(`external:${companyId}:${ip}`, 120, 60 * 1000);
  }

  @Get('health/me')
  async me(@Req() request: RequestWithApiCompany) {
    await this.external.assertApiEnabled(request.apiCompany.id);
    this.pace(request, request.apiCompany.id);
    return this.external.me(request.apiCompany.id);
  }

  @Get('employees')
  async employees(@Req() request: RequestWithApiCompany, @Query('page') page?: string, @Query('limit') limit?: string) {
    await this.external.assertApiEnabled(request.apiCompany.id);
    this.pace(request, request.apiCompany.id);
    return this.external.employees(request.apiCompany.id, String(page || ''), String(limit || ''));
  }

  @Get('leave/balances')
  async leaveBalances(
    @Req() request: RequestWithApiCompany,
    @Query('employeeCode') employeeCode?: string,
    @Query('year') year?: string,
  ) {
    await this.external.assertApiEnabled(request.apiCompany.id);
    this.pace(request, request.apiCompany.id);
    return this.external.leaveBalances(request.apiCompany.id, String(employeeCode || ''), String(year || ''));
  }

  @Post('enquiries/leads')
  async leads(@Req() request: RequestWithApiCompany, @Body() body: unknown) {
    await this.external.assertApiEnabled(request.apiCompany.id);
    this.pace(request, request.apiCompany.id);
    return this.external.createLead(request.apiCompany.id, body);
  }
}