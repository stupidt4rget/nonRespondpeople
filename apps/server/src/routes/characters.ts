import type { FastifyInstance } from 'fastify';
import type { Character } from '@prisma/client';
import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
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
    const { name, description } = (req.body ?? {}) as CreateCharacterRequest;
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
}
