import Fastify from 'fastify';
import { appName } from '@roleagent/shared';
import type { HealthResponse, DbHealthResponse } from '@roleagent/shared';
import { prisma } from './db/prisma.js';
import { characterRoutes } from './routes/characters.js';
import { chatRoutes } from './routes/chat.js';
import { settingsRoutes } from './routes/settings.js';

const app = Fastify({ logger: true });

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

const start = async () => {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  try {
    await app.register(characterRoutes);
    await app.register(settingsRoutes);
    await app.register(chatRoutes);
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
