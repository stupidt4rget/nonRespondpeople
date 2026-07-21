import type { FastifyInstance } from 'fastify';
import type { UserPersona } from '@prisma/client';
import type {
  CreateUserPersonaRequest,
  DeleteUserPersonaResponse,
  UpdateUserPersonaRequest,
  UserPersonaDto,
  UserPersonasResponse,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';

function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimRequiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toUserPersonaDto(persona: UserPersona): UserPersonaDto {
  return {
    id: persona.id,
    name: persona.name,
    description: persona.description,
    enabled: persona.enabled,
    createdAt: persona.createdAt.toISOString(),
    updatedAt: persona.updatedAt.toISOString(),
  };
}

function normalizeUpdate(body: UpdateUserPersonaRequest): UpdateUserPersonaRequest {
  const update: UpdateUserPersonaRequest = {};
  if (body.name !== undefined) {
    const name = trimRequiredText(body.name);
    if (!name) throw new Error('name must be a non-empty string');
    update.name = name;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      throw new Error('description must be a string');
    }
    update.description = body.description.trim();
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    update.enabled = body.enabled;
  }
  return update;
}

export async function userPersonaRoutes(app: FastifyInstance) {
  app.get('/api/user-personas', async () => {
    const personas = await prisma.userPersona.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const body: UserPersonasResponse = {
      personas: personas.map(toUserPersonaDto),
    };
    return body;
  });

  app.post('/api/user-personas', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as CreateUserPersonaRequest;
    const name = trimRequiredText(body.name);
    if (!name) {
      return reply
        .code(400)
        .send({ error: 'name is required and must be a non-empty string' });
    }
    if (typeof body.description !== 'string' || body.description.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'description is required and must be a non-empty string' });
    }

    const created = await prisma.userPersona.create({
      data: {
        name,
        description: body.description.trim(),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      },
    });
    return reply.code(201).send(toUserPersonaDto(created));
  });

  app.put('/api/user-personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const found = await prisma.userPersona.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'user persona not found' });
    }

    let update: UpdateUserPersonaRequest;
    try {
      update = normalizeUpdate(req.body as UpdateUserPersonaRequest);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }

    const updated = await prisma.userPersona.update({
      where: { id },
      data: update,
    });
    return toUserPersonaDto(updated);
  });

  app.delete('/api/user-personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.userPersona.findUnique({ where: { id } });
    if (!found) {
      return reply.code(404).send({ error: 'user persona not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const cleared = await tx.conversation.updateMany({
        where: { userPersonaId: id },
        data: { userPersonaId: null },
      });
      await tx.userPersona.delete({ where: { id } });
      return cleared.count;
    });

    const body: DeleteUserPersonaResponse = {
      ok: true,
      id,
      clearedConversationCount: result,
    };
    return body;
  });
}
