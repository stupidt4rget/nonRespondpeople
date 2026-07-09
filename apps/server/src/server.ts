import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { appName } from '@roleagent/shared';
import type { DbHealthResponse, HealthResponse } from '@roleagent/shared';
import { prisma } from './db/prisma.js';
import { characterRoutes } from './routes/characters.js';
import { chatRoutes } from './routes/chat.js';
import { settingsRoutes } from './routes/settings.js';
import { worldBookRoutes } from './routes/worldbooks.js';
import { conversationRoutes } from './routes/conversations.js';
import { promptPresetRoutes } from './routes/promptPresets.js';

export interface CreateServerOptions {
  logger?: boolean;
  staticRoot?: string;
}

export interface StartServerOptions extends CreateServerOptions {
  host?: string;
  port?: number;
}

export interface StartedServer {
  app: FastifyInstance;
  host: string;
  port: number;
  url: string;
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function resolveStaticPath(staticRoot: string, rawUrl: string): string | null {
  const root = path.resolve(staticRoot);
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    return null;
  }

  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const found = await stat(filePath);
    return found.isFile();
  } catch {
    return false;
  }
}

export async function createServer(
  options: CreateServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  app.get('/api/health', async () => {
    const body: HealthResponse = { status: 'ok', name: appName };
    return body;
  });

  app.get('/api/db-health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const body: DbHealthResponse = { status: 'ok', database: 'sqlite' };
      return body;
    } catch (err) {
      app.log.error(err);
      const body: DbHealthResponse = { status: 'error', database: 'sqlite' };
      return body;
    }
  });

  await app.register(characterRoutes);
  await app.register(settingsRoutes);
  await app.register(promptPresetRoutes);
  await app.register(worldBookRoutes);
  await app.register(conversationRoutes);
  await app.register(chatRoutes);

  if (options.staticRoot) {
    app.get('/*', async (request, reply) => {
      const requestedPath = resolveStaticPath(options.staticRoot!, request.url);
      if (requestedPath === null) {
        return reply.code(404).send({ error: 'not found' });
      }

      const filePath = (await fileExists(requestedPath))
        ? requestedPath
        : path.join(options.staticRoot!, 'index.html');
      const body = await readFile(filePath);
      return reply.type(getContentType(filePath)).send(body);
    });
  }

  return app;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? 3000;
  const app = await createServer(options);
  await app.listen({ host, port });

  const address = app.server.address();
  const actualPort =
    typeof address === 'object' && address !== null ? address.port : port;

  return {
    app,
    host,
    port: actualPort,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`,
  };
}

export function logServerStart(
  logger: FastifyBaseLogger,
  server: StartedServer,
): void {
  logger.info(`RoleAgent Tavern server listening at ${server.url}`);
}
