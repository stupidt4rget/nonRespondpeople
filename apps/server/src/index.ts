import { startServer } from './server.js';

const start = async () => {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  try {
    await startServer({ port, host, logger: true });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
