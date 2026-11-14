import { randomBytes } from 'crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Keeps every error a JSON message a person can act on. Unknown errors get a reference for the log. */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const message = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : error.message;
      response.status(status).json({ message: status === 404 && /^Cannot (GET|POST|PATCH|PUT|DELETE)/.test(message) ? 'That page or action was not found.' : message });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return void response.status(409).json({ message: 'That already exists. Use a different name or code.' });
      if (error.code === 'P2025') return void response.status(404).json({ message: 'That record was not found. It may have been removed.' });
      if (error.code === 'P2003') return void response.status(409).json({ message: 'That is still linked to other records, so it cannot be changed that way.' });
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      this.log.error('Database not reachable: ' + error.message);
      return void response.status(503).json({ message: 'The database is not reachable right now. Try again in a minute.' });
    }
    const reference = randomBytes(3).toString('hex').toUpperCase();
    this.log.error(`Ref ${reference}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    response.status(500).json({ message: `The server hit a problem with that. Try again, and if it keeps happening tell your admin the reference ${reference}.` });
  }
}
