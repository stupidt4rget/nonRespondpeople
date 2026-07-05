import type { FastifyInstance } from 'fastify';
import type { ChatMessage, Conversation } from '@prisma/client';
import type {
  CharacterConversationResponse,
  ChatMessageDto,
  ConversationDto,
  UpdateConversationWorldBooksRequest,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';
import { getDefaultWorldBookIds } from './worldbooks.js';

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function parseWorldBookIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function stringifyWorldBookIds(ids: string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

export function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    characterId: conversation.characterId,
    title: conversation.title,
    activeWorldBookIds: parseWorldBookIds(conversation.activeWorldBookIdsJson),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toChatMessageDto(message: ChatMessage): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function getOrCreateCharacterConversation(
  characterId: string,
): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { characterId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    if (existing.activeWorldBookIdsJson !== null) {
      return existing;
    }
    const defaultIds = await getDefaultWorldBookIds(characterId);
    return prisma.conversation.update({
      where: { id: existing.id },
      data: { activeWorldBookIdsJson: stringifyWorldBookIds(defaultIds) },
    });
  }

  const defaultIds = await getDefaultWorldBookIds(characterId);
  return prisma.conversation.create({
    data: {
      characterId,
      activeWorldBookIdsJson: stringifyWorldBookIds(defaultIds),
    },
  });
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  return prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
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

async function buildConversationResponse(
  conversation: Conversation,
): Promise<CharacterConversationResponse> {
  const messages = await getConversationMessages(conversation.id);
  const activeWorldBookIds = parseWorldBookIds(conversation.activeWorldBookIdsJson);
  const worldBooks = await prisma.worldBook.findMany({
    where: { id: { in: activeWorldBookIds } },
    orderBy: { updatedAt: 'desc' },
  });

  return {
    conversation: toConversationDto(conversation),
    messages: messages.map(toChatMessageDto),
    worldBooks: worldBooks.map((worldBook) => ({
      id: worldBook.id,
      name: worldBook.name,
      description: worldBook.description,
      entriesJson: worldBook.entriesJson,
      rawJson: worldBook.rawJson,
      createdAt: worldBook.createdAt.toISOString(),
      updatedAt: worldBook.updatedAt.toISOString(),
    })),
    activeWorldBookIds,
  };
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get('/api/characters/:id/conversation', async (req, reply) => {
    const { id } = req.params as { id: string };
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) {
      return reply.code(404).send({ error: 'character not found' });
    }
    const conversation = await getOrCreateCharacterConversation(id);
    return buildConversationResponse(conversation);
  });

  app.patch('/api/conversations/:id/worldbooks', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as UpdateConversationWorldBooksRequest;
    if (!Array.isArray(body.worldBookIds)) {
      return reply.code(400).send({ error: 'worldBookIds must be an array' });
    }
    const worldBookIds = body.worldBookIds.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'conversation not found' });
    }

    try {
      await assertWorldBooksExist(worldBookIds);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { activeWorldBookIdsJson: stringifyWorldBookIds(worldBookIds) },
    });
    return buildConversationResponse(updated);
  });
}
