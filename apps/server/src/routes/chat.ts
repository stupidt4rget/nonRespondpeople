import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatResponse } from '@roleagent/shared';
import { prisma } from '../db/prisma.js';
import { getActiveLlmSettings } from './settings.js';
import {
  getConversationMessages,
  getOrCreateCharacterConversation,
  toChatMessageDto,
  toConversationDto,
} from './conversations.js';
import { buildPromptMessages } from '../services/promptBuilder.js';

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

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const { characterId, message } = req.body as ChatRequest;

    if (
      typeof characterId !== 'string' ||
      characterId.trim() === ''
    ) {
      return reply
        .code(400)
        .send({ error: 'characterId is required and must be a non-empty string' });
    }
    if (typeof message !== 'string' || message.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'message is required and must be a non-empty string' });
    }

    const found = await prisma.character.findUnique({
      where: { id: characterId },
    });
    if (!found) {
      return reply.code(404).send({ error: 'character not found' });
    }

    const llmSettings = getActiveLlmSettings();
    if (!llmSettings) {
      return reply
        .code(500)
        .send({ error: 'LLM is not configured on the server' });
    }

    const conversation = await getOrCreateCharacterConversation(found);
    const savedMessages = await getConversationMessages(conversation.id);
    const activeWorldBookIds = parseWorldBookIds(conversation.activeWorldBookIdsJson);
    const worldBooks = await prisma.worldBook.findMany({
      where: { id: { in: activeWorldBookIds } },
      orderBy: { updatedAt: 'desc' },
    });

    const prompt = buildPromptMessages({
      character: found,
      worldBooks,
      history: savedMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      userMessage: message.trim(),
    });
    const messages = prompt.messages;
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    const url = `${llmSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let llmRes: Response;
    try {
      llmRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmSettings.apiKey}`,
        },
        body: JSON.stringify({ model: llmSettings.model, messages, stream: false }),
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'failed to reach LLM API' });
    }

    if (!llmRes.ok) {
      app.log.error(`LLM API returned HTTP ${llmRes.status}`);
      return reply
        .code(502)
        .send({ error: `LLM API returned HTTP ${llmRes.status}` });
    }

    const llmData = (await llmRes.json()) as { choices?: unknown };
    if (!Array.isArray(llmData.choices) || llmData.choices.length === 0) {
      return reply.code(502).send({ error: 'LLM API returned no choices' });
    }
    const choice = llmData.choices[0] as { message?: unknown };
    if (!choice.message || typeof choice.message !== 'object') {
      return reply
        .code(502)
        .send({ error: 'LLM API returned invalid message structure' });
    }
    const content = (choice.message as { content?: unknown }).content;
    if (typeof content !== 'string') {
      return reply
        .code(502)
        .send({ error: 'LLM API returned invalid content' });
    }

    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message.trim(),
        },
      }),
      prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content,
        },
      }),
    ]);
    const latestMessages = await getConversationMessages(conversation.id);

    const body: ChatResponse = {
      reply: content,
      conversation: toConversationDto(conversation),
      userMessage: toChatMessageDto(userMessage),
      assistantMessage: toChatMessageDto(assistantMessage),
      messages: latestMessages.map(toChatMessageDto),
      activeWorldBookIds,
    };
    return reply.send(body);
  });
}
