import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Connect, defineConfig, type Plugin } from 'vite';
import { POST as analyzePost } from './api/organize/analyze.ts';
import { POST as applyPost } from './api/organize/apply.ts';

type RouteHandler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, RouteHandler> = {
  '/api/organize/analyze': analyzePost,
  '/api/organize/apply': applyPost,
};

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

function toWebHeaders(rawHeaders: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? '127.0.0.1';
  const url = `http://${host}${req.url ?? '/'}`;
  const method = req.method ?? 'GET';
  const headers = toWebHeaders(req.headers);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);
  return new Request(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, webResponse: Response): Promise<void> {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await webResponse.arrayBuffer());
  res.end(body);
}

function attachOrganizeMiddleware(middlewares: Connect.Server): void {
  middlewares.use(async (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    const handler = ROUTES[pathname];
    if (!handler) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      await sendWebResponse(
        res,
        Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 }),
      );
      return;
    }

    try {
      const webRequest = await toWebRequest(req);
      const webResponse = await handler(webRequest);
      await sendWebResponse(res, webResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      await sendWebResponse(res, Response.json({ ok: false, error: message }, { status: 500 }));
    }
  });
}

export function organizeApiPlugin(): Plugin {
  return {
    name: 'organize-api',
    configureServer(server) {
      attachOrganizeMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachOrganizeMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [organizeApiPlugin()],
});
