import { Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { BrandService } from './brand.service';
import { DeviceService } from './device.service';
import { DirectoryService } from './directory.service';
import { FormsService } from './forms.service';
import { HiringService } from './hiring.service';
import { emailOf, loginPassword, bag } from './http';
import { PRODUCT_CODE, PRODUCT_VERSION } from './version';

@Controller('v1')
export class PublicController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly auth: AuthService,
    private readonly forms: FormsService,
    private readonly hiring: HiringService,
    private readonly devices: DeviceService,
    private readonly brand: BrandService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, product: PRODUCT_CODE, version: PRODUCT_VERSION };
  }

  @Post('start')
  start(@Req() request: Request, @Body() body: unknown) {
    this.auth.pace('start:' + this.ip(request), 5, 60 * 60 * 1000);
    return this.directory.start(body);
  }

  @Post('auth/login')
  login(@Req() request: Request, @Body() body: unknown) {
    const input = bag(body);
    return this.auth.login(emailOf(input.email), loginPassword(input.password), this.ip(request));
  }

  @Post('auth/forgot')
  forgot(@Req() request: Request, @Body() body: unknown) {
    return this.auth.forgot(emailOf(bag(body).email), this.ip(request));
  }

  @Post('auth/reset')
  reset(@Req() request: Request, @Body() body: unknown) {
    const input = bag(body);
    return this.auth.reset(String(input.token || ''), String(input.password || ''), this.ip(request));
  }

  @Get('apply/:slug')
  applyForm(@Param('slug') slug: string) {
    return this.forms.publicView(slug);
  }

  @Post('apply/:slug')
  apply(@Req() request: Request, @Param('slug') slug: string, @Body() body: unknown) {
    this.auth.pace('apply:' + this.ip(request), 20, 60 * 60 * 1000);
    return this.forms.publicSubmit(slug, body);
  }

  @Get('careers/:company/:code')
  career(@Param('company') company: string, @Param('code') code: string) {
    return this.hiring.publicView(company, code);
  }

  @Post('careers/:company/:code')
  applyForJob(@Req() request: Request, @Param('company') company: string, @Param('code') code: string, @Query('from') source: string, @Body() body: unknown) {
    this.auth.pace('apply:' + this.ip(request), 20, 60 * 60 * 1000);
    return this.hiring.publicApply(company, code, source || '', body);
  }

  @Get('feeds/:token/jobs')
  jobsFeed(@Param('token') token: string, @Query('portal') portal?: string) {
    return this.hiring.feed(token, portal);
  }

  @Get('feeds/:token/xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async jobsXml(@Param('token') token: string, @Query('portal') portal: string, @Res() response: Response) {
    const xml = await this.hiring.feedXml(token, portal);
    response.type('application/xml').send(xml);
  }

  @Get('mail/logo/:company')
  async mailLogo(@Param('company') company: string, @Res() response: Response) {
    const image = /^[a-z0-9]{10,40}$/i.test(company) ? await this.brand.image(company, 'logo') : null;
    if (!image) {
      response.status(404).end();
      return;
    }
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.type(image.type).send(image.bytes);
  }

  @Post('devices/:token/punches')
  devicePunches(@Req() request: Request, @Param('token') token: string, @Body() body: unknown) {
    this.auth.pace('device:' + this.ip(request), 120, 60 * 1000);
    return this.devices.ingest(token, body);
  }

  @Post('feeds/:token/:portal')
  portalApply(@Req() request: Request, @Param('token') token: string, @Param('portal') portal: string, @Body() body: unknown) {
    this.auth.pace('apply:' + this.ip(request), 20, 60 * 60 * 1000);
    return this.hiring.inbound(token, portal, body);
  }

  private ip(request: Request): string {
    return request.socket.remoteAddress || 'local';
  }
}
