import type { FastifyInstance } from 'fastify';
import type { AssistantMessageVariant, ChatMessage, Conversation } from '@prisma/client';
import type {
  AssistantMessageVariantDto,
  CharacterConversationResponse,
  ChatMessageDto,
  ConversationDto,
  GenerationSettingsDto,
  GenerationTimingDto,
  PromptAssemblyDebugDto,
  SelectMessageVariantResponse,
  UpdateChatMessageRequest,
  UpdateConversationWorldBooksRequest,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';
import { getDefaultWorldBookIds } from './worldbooks.js';
import { substituteMacros, type PromptCharacter } from '../services/promptBuilder.js';

interface ConversationCharacter extends PromptCharacter {
  id: string;
}

export type ChatMessageWithVariants = ChatMessage & {
  variants?: AssistantMessageVariant[];
};

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

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toVariantDto(variant: AssistantMessageVariant): AssistantMessageVariantDto {
  return {
    id: variant.id,
    messageId: variant.messageId,
    content: variant.content,
    thinkingContent: variant.thinkingContent,
    rawContent: variant.rawContent,
    timing: parseJsonField<GenerationTimingDto>(variant.timingJson),
    generationSettingsSnapshot: parseJsonField<GenerationSettingsDto>(
      variant.generationSettingsJson,
    ),
    createdAt: variant.createdAt.toISOString(),
  };
}

export function toChatMessageDto(message: ChatMessageWithVariants): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
    thinkingContent: message.thinkingContent,
    rawContent: message.rawContent,
    timing: parseJsonField<GenerationTimingDto>(message.timingJson),
    promptDebug: parseJsonField<PromptAssemblyDebugDto>(message.promptDebugJson),
    selectedVariantId: message.selectedVariantId,
    variants:
      message.variants && message.variants.length > 0
        ? message.variants.map(toVariantDto)
        : undefined,
    createdAt: message.createdAt.toISOString(),
  };
}

async function seedFirstMessageIfNeeded(
  conversation: Conversation,
  character: ConversationCharacter,
): Promise<void> {
  if (!character.firstMessage || character.firstMessage.trim() === '') return;
  const messageCount = await prisma.chatMessage.count({
    where: { conversationId: conversation.id },
  });
  if (messageCount > 0) return;

  const content = substituteMacros(character.firstMessage, character).trim();
  if (content === '') return;
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content,
    },
  });
}

export async function ensureConversationReady(
  conversation: Conversation,
  character: ConversationCharacter,
): Promise<Conversation> {
  let ready = conversation;
  if (ready.activeWorldBookIdsJson === null) {
    const defaultIds = await getDefaultWorldBookIds(character.id);
    ready = await prisma.conversation.update({
      where: { id: ready.id },
      data: { activeWorldBookIdsJson: stringifyWorldBookIds(defaultIds) },
    });
  }
  await seedFirstMessageIfNeeded(ready, character);
  return ready;
}

export async function getOrCreateCharacterConversation(
  character: ConversationCharacter,
): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { characterId: character.id },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    return ensureConversationReady(existing, character);
  }

  const defaultIds = await getDefaultWorldBookIds(character.id);
  const conversation = await prisma.conversation.create({
    data: {
      characterId: character.id,
      activeWorldBookIdsJson: stringifyWorldBookIds(defaultIds),
    },
  });
  await seedFirstMessageIfNeeded(conversation, character);
  return conversation;
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ChatMessageWithVariants[]> {
  return prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      variants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
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

export async function buildConversationResponse(
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
    const conversation = await getOrCreateCharacterConversation(character);
    return buildConversationResponse(conversation);
  });

  app.patch('/api/conversations/:conversationId/messages/:messageId', async (req, reply) => {
    const { conversationId, messageId } = req.params as {
      conversationId: string;
      messageId: string;
    };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const { content } = req.body as UpdateChatMessageRequest;
    if (typeof content !== 'string' || content.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'content is required and must be a non-empty string' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      return reply.code(404).send({ error: 'conversation not found' });
    }
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) {
      return reply.code(404).send({ error: 'message not found' });
    }

    await prisma.chatMessage.update({
      where: { id: message.id },
      data: {
        content: content.trim(),
        rawContent: content.trim(),
        thinkingContent: null,
      },
    });
    return buildConversationResponse(conversation);
  });

  app.patch(
    '/api/conversations/:conversationId/messages/:messageId/variants/:variantId/select',
    async (req, reply) => {
      const { conversationId, messageId, variantId } = req.params as {
        conversationId: string;
        messageId: string;
        variantId: string;
      };
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!conversation) {
        return reply.code(404).send({ error: 'conversation not found' });
      }
      const message = await prisma.chatMessage.findFirst({
        where: { id: messageId, conversationId, role: 'assistant' },
      });
      if (!message) {
        return reply.code(404).send({ error: 'assistant message not found' });
      }
      const variant = await prisma.assistantMessageVariant.findFirst({
        where: { id: variantId, messageId },
      });
      if (!variant) {
        return reply.code(404).send({ error: 'message variant not found' });
      }

      await prisma.chatMessage.update({
        where: { id: message.id },
        data: {
          content: variant.content,
          rawContent: variant.rawContent,
          thinkingContent: variant.thinkingContent,
          timingJson: variant.timingJson,
          selectedVariantId: variant.id,
        },
      });
      const response = await buildConversationResponse(conversation);
      return response satisfies SelectMessageVariantResponse;
    },
  );

  app.delete('/api/conversations/:conversationId/messages/:messageId', async (req, reply) => {
    const { conversationId, messageId } = req.params as {
      conversationId: string;
      messageId: string;
    };
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      return reply.code(404).send({ error: 'conversation not found' });
    }
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) {
      return reply.code(404).send({ error: 'message not found' });
    }

    await prisma.chatMessage.delete({ where: { id: message.id } });
    return buildConversationResponse(conversation);
  });

  app.delete('/api/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { character: true },
    });
    if (!conversation) {
      return reply.code(404).send({ error: 'conversation not found' });
    }

    await prisma.chatMessage.deleteMany({ where: { conversationId: id } });
    const readyConversation = await ensureConversationReady(
      conversation,
      conversation.character,
    );
    return buildConversationResponse(readyConversation);
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
