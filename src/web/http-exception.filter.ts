import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { page } from './page';

/**
 * Public pages set Content-Type to text/html. Nest's default filter still writes
 * `{"statusCode":500,"message":"Internal server error"}`, which is what the browser shows.
 */
@Catch()
export class HtmlExceptionFilter implements ExceptionFilter {
  private log = new Logger(HtmlExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (!(exception instanceof HttpException)) {
      const err = exception as Error;
      this.log.error(err?.message || String(exception), err?.stack);
    }
    if (res.headersSent) return;

    if (wantsHtml(req)) {
      const copy =
        status === 404
          ? { title: 'Not found', inner: `<h1>Not found</h1><p><a href="/">Back home</a></p>` }
          : status === 403
            ? { title: "That link didn't work", inner: `<h1>That link didn't work</h1><p>Open the link from the email again.</p>` }
            : {
                title: 'Something went wrong',
                inner: `<h1>Something went wrong</h1><p>Please try again in a minute.</p><p><a href="/">Back home</a></p>`,
              };
      res.status(status).type('html').send(page(copy.title, copy.inner));
      return;
    }

    const body = exception instanceof HttpException ? exception.getResponse() : { statusCode: status, message: 'Internal server error' };
    res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
  }
}

function wantsHtml(req: Request): boolean {
  const accept = String(req.headers.accept ?? '');
  if (accept.includes('text/html')) return true;
  const path = req.path || String(req.url || '').split('?')[0];
  if (path === '/' || path === '/subscribe' || path === '/notes' || path.startsWith('/notes/') || path.startsWith('/topics')) return true;
  if (path.startsWith('/confirm/') || path.startsWith('/unsubscribe/') || path.startsWith('/preferences/')) return true;
  return /\/admin\/(meetings|dives)\/[^/]+\/(approve|preview|reject)$/.test(path) || /\/admin\/topics/.test(path);
}
