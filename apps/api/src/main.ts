import { config } from 'dotenv';
import { existsSync } from 'fs';
import { json, static as expressStatic, type NextFunction, type Request, type Response } from 'express';
import { join, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorsFilter } from './errors.filter';
import { outletStore } from './outlet-context';

config({ path: resolve(__dirname, '../.env') });

function webDir(): string | null {
  const candidates = [
    process.env.HRMS_WEB_ROOT,
    join(__dirname, '../../web/dist/web/browser'),
    join(__dirname, '../../web/dist/web'),
    join(process.cwd(), 'apps/web/dist/web/browser'),
    join(process.cwd(), 'apps/web/dist/web'),
    join(process.cwd(), 'public'),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const uploads = new Set(['/v1/library/files', '/v1/library/handbook', '/v1/pay/form', '/v1/brand/icon', '/v1/brand/logo']);
  const large = json({ limit: '12mb' });
  const applying = json({ limit: '18mb' });
  const small = json({ limit: '256kb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return small(req, res, next);
    if (/^\/v1\/apply\/[a-z0-9-]{2,60}$/i.test(req.path)) return applying(req, res, next);
    return (uploads.has(req.path) ? large : small)(req, res, next);
  });
  app.use((error: { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') return void res.status(413).json({ message: 'That is too large to send in one go. Shorten the text or choose a smaller file.' });
    if (error?.type === 'entity.parse.failed') return void res.status(400).json({ message: 'The request could not be read. Refresh the page and try again.' });
    next(error);
  });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });
  app.use((_req: Request, _res: Response, next: NextFunction) => outletStore.run({ scope: null }, next));
  const origin = (process.env.CORS_ORIGIN || 'http://localhost:4400,http://127.0.0.1:4400').split(',').map((item) => item.trim()).filter(Boolean);
  app.enableCors({ origin });
  app.useGlobalFilters(new ErrorsFilter());
  app.enableShutdownHooks();

  const web = webDir();
  if (web) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/v1')) return next();
      return expressStatic(web, { index: false })(req, res, next);
    });
    expressApp.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/v1')) return next();
      res.sendFile(join(web, 'index.html'), (err) => (err ? next(err) : undefined));
    });
    console.log('Serving HRMS web from ' + web);
  }

  await app.listen(Number(process.env.PORT || 4300));
}
void bootstrap();
