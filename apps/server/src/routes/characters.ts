import type { FastifyInstance } from 'fastify';
import type { Character } from '@prisma/client';
import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  DeleteCharacterResponse,
  ImportCharacterCardRequest,
  ExportCharacterCardResponse,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';
import {
  createWorldBookFromCharacterBook,
  extractCharacterBookFromCard,
} from './worldbooks.js';

function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    description: character.description,
    persona: character.persona,
    personality: character.personality,
    scenario: character.scenario,
    firstMessage: character.firstMessage,
    messageExample: character.messageExample,
    systemPrompt: character.systemPrompt,
    postHistoryInstructions: character.postHistoryInstructions,
    rawCardJson: character.rawCardJson,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
  };
}

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseJson(value: string | null | undefined): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const OPTIONAL_CARD_FIELDS = [
  'description',
  'persona',
  'personality',
  'scenario',
  'firstMessage',
  'messageExample',
  'systemPrompt',
  'postHistoryInstructions',
] as const;

export async function characterRoutes(app: FastifyInstance) {
  app.get('/api/characters', async () => {
    const characters = await prisma.character.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const body: CharactersResponse = {
      characters: characters.map(toCharacterDto),
    };
    return body;
  });

  app.post('/api/characters', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as CreateCharacterRequest;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return reply.code(400).send({
        error: 'name is required and must be a non-empty string',
      });
    }
    const created = await prisma.character.create({
      data: {
        name: body.name.trim(),
        description: strOrNull(body.description),
        persona: strOrNull(body.persona),
        personality: strOrNull(body.personality),
        scenario: strOrNull(body.scenario),
        firstMessage: strOrNull(body.firstMessage),
        messageExample: strOrNull(body.messageExample),
        systemPrompt: strOrNull(body.systemPrompt),
        postHistoryInstructions: strOrNull(body.postHistoryInstructions),
      },
    });
    return reply.code(201).send(toCharacterDto(created));
  });

  // Import route placed before /:id to avoid param matching issues.
  app.post('/api/characters/import', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as ImportCharacterCardRequest;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return reply.code(400).send({
        error: 'name is required and must be a non-empty string',
      });
    }
    const created = await prisma.character.create({
      data: {
        name: body.name.trim(),
        description: strOrNull(body.description),
        persona: strOrNull(body.persona),
        personality: strOrNull(body.personality),
        scenario: strOrNull(body.scenario),
        firstMessage: strOrNull(body.firstMessage),
        messageExample: strOrNull(body.messageExample),
        systemPrompt: strOrNull(body.systemPrompt),
        postHistoryInstructions: strOrNull(body.postHistoryInstructions),
        rawCardJson: strOrNull(body.rawCardJson),
      },
    });

    const rawCard = parseJson(body.rawCardJson);
    const characterBook =
      body.characterBook ?? extractCharacterBookFromCard(rawCard);
    if (characterBook !== null && characterBook !== undefined) {
      await createWorldBookFromCharacterBook({
        characterId: created.id,
        characterName: created.name,
        characterBook,
      });
    }

    return reply.code(201).send(toCharacterDto(created));
  });

  app.get('/api/characters/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.character.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'character not found' });
    }

    const linkedWorldBook = await prisma.characterWorldBook.findFirst({
      where: { characterId: id, isDefault: true },
      include: { worldBook: true },
      orderBy: { createdAt: 'asc' },
    });
    const rawCard = parseJson(found.rawCardJson);
    const rawCharacterBook = extractCharacterBookFromCard(rawCard);
    const linkedRawBook = parseJson(linkedWorldBook?.worldBook.rawJson);

    const body: ExportCharacterCardResponse = {
      name: found.name,
      description: found.description ?? undefined,
      persona: found.persona ?? undefined,
      personality: found.personality ?? undefined,
      scenario: found.scenario ?? undefined,
      first_mes: found.firstMessage ?? undefined,
      mes_example: found.messageExample ?? undefined,
      system_prompt: found.systemPrompt ?? undefined,
      post_history_instructions: found.postHistoryInstructions ?? undefined,
      character_book: rawCharacterBook ?? linkedRawBook ?? undefined,
    };
    return reply.send(body);
  });

  app.get('/api/characters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.character.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'character not found' });
    }
    return reply.send(toCharacterDto(found));
  });

  app.patch('/api/characters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as UpdateCharacterRequest;
    const { name } = body;

    if (name !== undefined && typeof name !== 'string') {
      return reply.code(400).send({ error: 'name must be a string' });
    }
    if (typeof name === 'string' && name.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'name must be a non-empty string' });
    }

    // Validate optional string|null fields
    for (const field of OPTIONAL_CARD_FIELDS) {
      const value = body[field];
      if (
        value !== undefined &&
        value !== null &&
        typeof value !== 'string'
      ) {
        return reply
          .code(400)
          .send({ error: `${field} must be a string or null` });
      }
    }

    // Check at least one field provided
    const hasName = name !== undefined;
    const hasOptional = OPTIONAL_CARD_FIELDS.some(
      (f) => body[f] !== undefined,
    );
    if (!hasName && !hasOptional) {
      return reply
        .code(400)
        .send({ error: 'must provide at least one field to update' });
    }

    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'character not found' });
    }

    const data: {
      name?: string;
      description?: string | null;
      persona?: string | null;
      personality?: string | null;
      scenario?: string | null;
      firstMessage?: string | null;
      messageExample?: string | null;
      systemPrompt?: string | null;
      postHistoryInstructions?: string | null;
    } = {};
    if (typeof name === 'string') data.name = name.trim();
    for (const field of OPTIONAL_CARD_FIELDS) {
      const value = body[field];
      if (value !== undefined) {
        data[field] = typeof value === 'string' ? value : null;
      }
    }

    const updated = await prisma.character.update({ where: { id }, data });
    return reply.send(toCharacterDto(updated));
  });

  app.delete('/api/characters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'character not found' });
    }
    await prisma.character.delete({ where: { id } });
    const body: DeleteCharacterResponse = { ok: true, id };
    return reply.send(body);
  });
}
