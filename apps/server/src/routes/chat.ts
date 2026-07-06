import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ChatRequest, ChatResponse, RegenerateChatResponse } from '@roleagent/shared';
import type { Character, Conversation, WorldBook } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { getActiveLlmSettings } from './settings.js';
import {
  ensureConversationReady,
  getConversationMessages,
  getOrCreateCharacterConversation,
  toChatMessageDto,
  toConversationDto,
} from './conversations.js';
import { buildPromptMessages, type PromptMessage } from '../services/promptBuilder.js';

type ActiveLlmSettings = NonNullable<ReturnType<typeof getActiveLlmSettings>>;

class LlmRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

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

async function loadPromptContext(
  character: Character,
  conversation: Conversation,
): Promise<{
  conversation: Conversation;
  activeWorldBookIds: string[];
  worldBooks: WorldBook[];
}> {
  const readyConversation = await ensureConversationReady(conversation, character);
  const activeWorldBookIds = parseWorldBookIds(readyConversation.activeWorldBookIdsJson);
  const worldBooks = await prisma.worldBook.findMany({
    where: { id: { in: activeWorldBookIds } },
    orderBy: { updatedAt: 'desc' },
  });

  return {
    conversation: readyConversation,
    activeWorldBookIds,
    worldBooks,
  };
}

async function requestAssistantReply(
  app: FastifyInstance,
  llmSettings: ActiveLlmSettings,
  messages: PromptMessage[],
): Promise<string> {
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
    throw new LlmRequestError(502, 'failed to reach LLM API');
  }

  if (!llmRes.ok) {
    app.log.error(`LLM API returned HTTP ${llmRes.status}`);
    throw new LlmRequestError(502, `LLM API returned HTTP ${llmRes.status}`);
  }

  const llmData = (await llmRes.json()) as { choices?: unknown };
  if (!Array.isArray(llmData.choices) || llmData.choices.length === 0) {
    throw new LlmRequestError(502, 'LLM API returned no choices');
  }
  const choice = llmData.choices[0] as { message?: unknown };
  if (!choice.message || typeof choice.message !== 'object') {
    throw new LlmRequestError(502, 'LLM API returned invalid message structure');
  }
  const content = (choice.message as { content?: unknown }).content;
  if (typeof content !== 'string') {
    throw new LlmRequestError(502, 'LLM API returned invalid content');
  }

  return content;
}

function sendLlmError(reply: FastifyReply, err: unknown) {
  if (err instanceof LlmRequestError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  return reply.code(502).send({ error: 'LLM API request failed' });
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

    const createdConversation = await getOrCreateCharacterConversation(found);
    const {
      conversation,
      activeWorldBookIds,
      worldBooks,
    } = await loadPromptContext(found, createdConversation);
    const savedMessages = await getConversationMessages(conversation.id);

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

    let content: string;
    try {
      content = await requestAssistantReply(app, llmSettings, messages);
    } catch (err) {
      return sendLlmError(reply, err);
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

  app.post('/api/conversations/:id/regenerate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.conversation.findUnique({
      where: { id },
      include: { character: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'conversation not found' });
    }

    const llmSettings = getActiveLlmSettings();
    if (!llmSettings) {
      return reply
        .code(500)
        .send({ error: 'LLM is not configured on the server' });
    }

    const {
      conversation,
      activeWorldBookIds,
      worldBooks,
    } = await loadPromptContext(existing.character, existing);
    const savedMessages = await getConversationMessages(conversation.id);
    const lastMessage = savedMessages.at(-1);
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return reply
        .code(400)
        .send({ error: 'last message must be an assistant message to regenerate' });
    }

    const previousMessage = savedMessages.at(-2);
    if (!previousMessage || previousMessage.role !== 'user') {
      return reply
        .code(400)
        .send({ error: 'assistant message must follow a user message to regenerate' });
    }

    const history = savedMessages.slice(0, -2).map((m) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));
    const prompt = buildPromptMessages({
      character: existing.character,
      worldBooks,
      history,
      userMessage: previousMessage.content,
    });
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    let content: string;
    try {
      content = await requestAssistantReply(app, llmSettings, prompt.messages);
    } catch (err) {
      return sendLlmError(reply, err);
    }

    const assistantMessage = await prisma.chatMessage.update({
      where: { id: lastMessage.id },
      data: { content },
    });
    const latestMessages = await getConversationMessages(conversation.id);

    const body: RegenerateChatResponse = {
      reply: content,
      conversation: toConversationDto(conversation),
      assistantMessage: toChatMessageDto(assistantMessage),
      messages: latestMessages.map(toChatMessageDto),
      activeWorldBookIds,
    };
    return reply.send(body);
  });
}
