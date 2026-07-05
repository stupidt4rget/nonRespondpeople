import type { FastifyInstance } from 'fastify';
import type { WorldBook } from '@prisma/client';
import type {
  CharacterWorldBooksResponse,
  DeleteWorldBookResponse,
  ImportWorldBookRequest,
  WorldBookDto,
  WorldBooksResponse,
  UpdateCharacterWorldBooksRequest,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toWorldBookDto(worldBook: WorldBook): WorldBookDto {
  return {
    id: worldBook.id,
    name: worldBook.name,
    description: worldBook.description,
    entriesJson: worldBook.entriesJson,
    rawJson: worldBook.rawJson,
    createdAt: worldBook.createdAt.toISOString(),
    updatedAt: worldBook.updatedAt.toISOString(),
  };
}

function parseJson(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function extractCharacterBookFromCard(card: unknown): unknown | null {
  if (!isPlainObject(card)) return null;
  const nested = isPlainObject(card.data) ? card.data.character_book : undefined;
  const root = card.character_book;
  return nested ?? root ?? null;
}

function normalizeWorldBookRaw(rawJson: unknown): unknown {
  const characterBook = extractCharacterBookFromCard(rawJson);
  return characterBook ?? rawJson;
}

function getWorldBookName(raw: unknown, fallback: string): string {
  if (isPlainObject(raw)) {
    const name = raw.name;
    if (typeof name === 'string' && name.trim() !== '') {
      return name.trim();
    }
  }
  return fallback;
}

function getWorldBookDescription(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  return strOrNull(raw.description) ?? strOrNull(raw.comment);
}

function getEntriesJson(raw: unknown): string {
  if (isPlainObject(raw) && raw.entries !== undefined) {
    return JSON.stringify(raw.entries);
  }
  return JSON.stringify(raw);
}

async function assertWorldBooksExist(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  const found = await prisma.worldBook.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true },
  });
  if (found.length !== uniqueIds.length) {
    throw new Error('one or more worldbooks were not found');
  }
}

export async function createWorldBookFromCharacterBook(args: {
  characterId: string;
  characterName: string;
  characterBook: unknown;
}): Promise<WorldBookDto | null> {
  const raw = normalizeWorldBookRaw(args.characterBook);
  if (raw === null || raw === undefined) return null;

  const created = await prisma.worldBook.create({
    data: {
      name: getWorldBookName(raw, `${args.characterName} 世界书`),
      description: getWorldBookDescription(raw),
      entriesJson: getEntriesJson(raw),
      rawJson: JSON.stringify(raw),
      characterLinks: {
        create: {
          characterId: args.characterId,
          isDefault: true,
        },
      },
    },
  });

  return toWorldBookDto(created);
}

export async function getDefaultWorldBookIds(characterId: string): Promise<string[]> {
  const links = await prisma.characterWorldBook.findMany({
    where: { characterId, isDefault: true },
    orderBy: { createdAt: 'asc' },
    select: { worldBookId: true },
  });
  return links.map((link) => link.worldBookId);
}

export async function worldBookRoutes(app: FastifyInstance) {
  app.get('/api/worldbooks', async () => {
    const worldBooks = await prisma.worldBook.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const body: WorldBooksResponse = {
      worldBooks: worldBooks.map(toWorldBookDto),
    };
    return body;
  });

  app.post('/api/worldbooks/import', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const body = req.body as unknown as ImportWorldBookRequest;
    const raw = normalizeWorldBookRaw(body.rawJson);
    if (raw === null || raw === undefined) {
      return reply.code(400).send({ error: 'rawJson is required' });
    }

    const created = await prisma.worldBook.create({
      data: {
        name: strOrNull(body.name) ?? getWorldBookName(raw, '未命名世界书'),
        description: strOrNull(body.description) ?? getWorldBookDescription(raw),
        entriesJson: getEntriesJson(raw),
        rawJson: JSON.stringify(raw),
      },
    });

    return reply.code(201).send(toWorldBookDto(created));
  });

  app.get('/api/worldbooks/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.worldBook.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'worldbook not found' });
    }

    const raw = parseJson(found.rawJson);
    return reply.send(
      raw ?? {
        name: found.name,
        description: found.description,
        entries: parseJson(found.entriesJson) ?? [],
      },
    );
  });

  app.delete('/api/worldbooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.worldBook.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'worldbook not found' });
    }
    await prisma.worldBook.delete({ where: { id } });
    const body: DeleteWorldBookResponse = { ok: true, id };
    return reply.send(body);
  });

  app.get('/api/characters/:id/worldbooks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) {
      return reply.code(404).send({ error: 'character not found' });
    }

    const links = await prisma.characterWorldBook.findMany({
      where: { characterId: id },
      include: { worldBook: true },
      orderBy: { createdAt: 'asc' },
    });

    const body: CharacterWorldBooksResponse = {
      characterId: id,
      worldBooks: links.map((link) => toWorldBookDto(link.worldBook)),
      worldBookIds: links.map((link) => link.worldBookId),
    };
    return body;
  });

  app.put('/api/characters/:id/worldbooks', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as unknown as UpdateCharacterWorldBooksRequest;
    if (!Array.isArray(body.worldBookIds)) {
      return reply.code(400).send({ error: 'worldBookIds must be an array' });
    }
    const worldBookIds = body.worldBookIds.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );

    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) {
      return reply.code(404).send({ error: 'character not found' });
    }

    try {
      await assertWorldBooksExist(worldBookIds);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }

    const uniqueIds = [...new Set(worldBookIds)];
    await prisma.$transaction([
      prisma.characterWorldBook.deleteMany({ where: { characterId: id } }),
      ...uniqueIds.map((worldBookId) =>
        prisma.characterWorldBook.create({
          data: { characterId: id, worldBookId, isDefault: true },
        }),
      ),
    ]);

    const linked = await prisma.characterWorldBook.findMany({
      where: { characterId: id },
      include: { worldBook: true },
      orderBy: { createdAt: 'asc' },
    });

    const bodyRes: CharacterWorldBooksResponse = {
      characterId: id,
      worldBooks: linked.map((link) => toWorldBookDto(link.worldBook)),
      worldBookIds: linked.map((link) => link.worldBookId),
    };
    return bodyRes;
  });
}
