import type { FastifyInstance } from 'fastify';
import type { Character } from '@prisma/client';
import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  DeleteCharacterResponse,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';

function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    description: character.description,
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
    const { name, description } = req.body as CreateCharacterRequest;
    if (typeof name !== 'string' || name.trim() === '') {
      return reply.code(400).send({
        error: 'name is required and must be a non-empty string',
      });
    }
    const created = await prisma.character.create({
      data: {
        name: name.trim(),
        description: typeof description === 'string' ? description : null,
      },
    });
    return reply.code(201).send(toCharacterDto(created));
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
    const { name, description } = req.body as UpdateCharacterRequest;

    if (name !== undefined && typeof name !== 'string') {
      return reply.code(400).send({ error: 'name must be a string' });
    }
    if (typeof name === 'string' && name.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'name must be a non-empty string' });
    }
    if (
      description !== undefined &&
      description !== null &&
      typeof description !== 'string'
    ) {
      return reply
        .code(400)
        .send({ error: 'description must be a string or null' });
    }
    if (name === undefined && description === undefined) {
      return reply
        .code(400)
        .send({ error: 'must provide name or description to update' });
    }

    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'character not found' });
    }

    const data: { name?: string; description?: string | null } = {};
    if (typeof name === 'string') data.name = name.trim();
    if (description !== undefined) {
      data.description = typeof description === 'string' ? description : null;
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
