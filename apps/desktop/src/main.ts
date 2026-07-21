import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopDev = process.env.ROLEAGENT_DESKTOP_DEV === '1';
const desktopDevUrl =
  process.env.ROLEAGENT_DESKTOP_DEV_URL ?? 'http://127.0.0.1:5173';
const desktopDevPort = Number(process.env.ROLEAGENT_DESKTOP_DEV_PORT ?? 3002);

let startedServer: Awaited<
  ReturnType<typeof import('@roleagent/server')['startServer']>
> | null = null;
let isClosing = false;

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function toPrismaSqliteUrl(filePath: string): string {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

function getDatabasePath(): string {
  const dataDir = getDataDir();
  const fileName = desktopDev
    ? 'roleagent-tavern-dev.sqlite'
    : 'roleagent-tavern.sqlite';
  return path.join(dataDir, fileName);
}

function getDataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

function getMigrationsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server-prisma', 'migrations');
  }
  return path.join(repoRoot(), 'apps', 'server', 'prisma', 'migrations');
}

function getWebDistRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist');
  }
  return path.join(repoRoot(), 'apps', 'web', 'dist');
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function initializeDatabase(databaseUrl: string): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_roleagent_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsRoot = getMigrationsRoot();
    const migrationNames = (await readdir(migrationsRoot, {
      withFileTypes: true,
    }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationNames) {
      const applied = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        'SELECT "name" FROM "_roleagent_migrations" WHERE "name" = ?',
        migrationName,
      );
      if (applied.length > 0) continue;

      const migrationSql = await readFile(
        path.join(migrationsRoot, migrationName, 'migration.sql'),
        'utf8',
      );
      const statements = splitSqlStatements(migrationSql);

      await prisma.$transaction(async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRawUnsafe(
          'INSERT INTO "_roleagent_migrations" ("name") VALUES (?)',
          migrationName,
        );
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function createWindow(url: string): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(url);
  return mainWindow;
}

async function startBackend(): Promise<string> {
  const databasePath = getDatabasePath();
  await mkdir(path.dirname(databasePath), { recursive: true });
  const databaseUrl = toPrismaSqliteUrl(databasePath);
  process.env.DATABASE_URL = databaseUrl;
  process.env.ROLEAGENT_DATA_DIR = getDataDir();

  await initializeDatabase(databaseUrl);

  const { startServer } = await import('@roleagent/server');
  startedServer = await startServer({
    host: '127.0.0.1',
    port: desktopDev ? desktopDevPort : 0,
    logger: !app.isPackaged,
    staticRoot: desktopDev ? undefined : getWebDistRoot(),
  });

  return startedServer.url;
}

async function shutdown(): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  if (startedServer) {
    await startedServer.app.close();
    startedServer = null;
  }
}

app.on('before-quit', (event) => {
  if (!startedServer || isClosing) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
});

void app
  .whenReady()
  .then(async () => {
    const backendUrl = await startBackend();
    const url = desktopDev ? desktopDevUrl : backendUrl;

    if (!desktopDev && !existsSync(getWebDistRoot())) {
      throw new Error(`Web build output not found: ${getWebDistRoot()}`);
    }

    await createWindow(url);

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow(url);
      }
    });
  })
  .catch((err: unknown) => {
    console.error(err);
    app.quit();
  });
