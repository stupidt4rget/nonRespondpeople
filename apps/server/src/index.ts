import Fastify from 'fastify';
import { appName } from '@roleagent/shared';
import type { HealthResponse } from '@roleagent/shared';

const app = Fastify({ logger: true });

app.get('/api/health', async () => {
  const body: HealthResponse = { status: 'ok', name: appName };
  return body;
});

const start = async () => {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
