import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  RegenerateChatResponse,
} from '@roleagent/shared';
import type { Character, Conversation, WorldBook } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { getActiveLlmSettings, getActivePromptSettings } from './settings.js';
import { getActivePromptPresetEntries } from './promptPresets.js';
import {
  ensureConversationReady,
  getConversationMessages,
  getOrCreateCharacterConversation,
  toChatMessageDto,
  toConversationDto,
} from './conversations.js';
import { getAssistantVisibleContent } from '../services/assistantMessageParts.js';
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

class LlmAbortError extends Error {
  constructor() {
    super('LLM request aborted');
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

function isAbortError(err: unknown): boolean {
  return (
    err instanceof LlmAbortError ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function extractStreamDelta(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const firstChoice = choices[0] as { delta?: unknown; message?: unknown };
  const delta = firstChoice.delta;
  if (delta && typeof delta === 'object') {
    const content = (delta as { content?: unknown }).content;
    return typeof content === 'string' ? content : '';
  }
  const message = firstChoice.message;
  if (message && typeof message === 'object') {
    const content = (message as { content?: unknown }).content;
    return typeof content === 'string' ? content : '';
  }
  return '';
}

function parseSseData(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join('\n').trim();
}

async function streamAssistantReply(args: {
  app: FastifyInstance;
  llmSettings: ActiveLlmSettings;
  messages: PromptMessage[];
  signal: AbortSignal;
  onDelta: (content: string) => void;
}): Promise<string> {
  const url = `${args.llmSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let llmRes: Response;
  try {
    llmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.llmSettings.apiKey}`,
      },
      body: JSON.stringify({
        model: args.llmSettings.model,
        messages: args.messages,
        stream: true,
      }),
      signal: args.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw new LlmAbortError();
    args.app.log.error('failed to reach LLM API');
    throw new LlmRequestError(502, 'failed to reach LLM API');
  }

  if (!llmRes.ok) {
    args.app.log.error(`LLM API returned HTTP ${llmRes.status}`);
    throw new LlmRequestError(502, `LLM API returned HTTP ${llmRes.status}`);
  }
  if (!llmRes.body) {
    throw new LlmRequestError(502, 'LLM API returned no response body');
  }

  const reader = llmRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let done = false;

  try {
    while (!done) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let eventEnd = buffer.indexOf('\n\n');
      while (eventEnd !== -1) {
        const rawEvent = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        const data = parseSseData(rawEvent);
        if (data === '[DONE]') {
          done = true;
          break;
        }
        if (data) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data) as unknown;
          } catch {
            throw new LlmRequestError(502, 'LLM API returned invalid stream chunk');
          }
          const delta = extractStreamDelta(parsed);
          if (delta !== '') {
            content += delta;
            args.onDelta(delta);
          }
        }
        eventEnd = buffer.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw new LlmAbortError();
    throw err;
  } finally {
    reader.releaseLock();
  }

  if (args.signal.aborted) throw new LlmAbortError();
  if (!done) {
    throw new LlmRequestError(502, 'LLM API stream ended before completion');
  }

  return content;
}

function startNdjsonReply(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
}

function writeNdjsonEvent(reply: FastifyReply, event: ChatStreamEvent): void {
  if (reply.raw.writableEnded || reply.raw.destroyed) return;
  reply.raw.write(`${JSON.stringify(event)}\n`);
}

function endNdjsonReply(reply: FastifyReply): void {
  if (!reply.raw.writableEnded && !reply.raw.destroyed) {
    reply.raw.end();
  }
}

function sendLlmError(reply: FastifyReply, err: unknown) {
  if (err instanceof LlmRequestError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  return reply.code(502).send({ error: 'LLM API request failed' });
}

function toPromptHistory(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((message) => {
    const role = message.role === 'user' ? 'user' : 'assistant';
    return {
      role,
      content:
        role === 'assistant'
          ? getAssistantVisibleContent(message.content)
          : message.content,
    };
  });
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
    const promptSettings = await getActivePromptSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();

    const prompt = buildPromptMessages({
      character: found,
      worldBooks,
      history: toPromptHistory(savedMessages),
      userMessage: message.trim(),
      promptSettings,
      promptPresetEntries,
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

  app.post('/api/chat/stream', async (req, reply) => {
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
    const promptSettings = await getActivePromptSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();

    const prompt = buildPromptMessages({
      character: found,
      worldBooks,
      history: toPromptHistory(savedMessages),
      userMessage: message.trim(),
      promptSettings,
      promptPresetEntries,
    });
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    startNdjsonReply(reply);

    const upstreamController = new AbortController();
    let clientClosed = false;
    let streamFinished = false;
    const abortUpstream = () => {
      if (streamFinished) return;
      clientClosed = true;
      upstreamController.abort();
    };
    reply.raw.on('close', abortUpstream);

    try {
      const content = await streamAssistantReply({
        app,
        llmSettings,
        messages: prompt.messages,
        signal: upstreamController.signal,
        onDelta: (delta) => writeNdjsonEvent(reply, { type: 'delta', content: delta }),
      });
      if (clientClosed || upstreamController.signal.aborted) return;

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

      writeNdjsonEvent(reply, {
        type: 'done',
        reply: content,
        conversation: toConversationDto(conversation),
        userMessage: toChatMessageDto(userMessage),
        assistantMessage: toChatMessageDto(assistantMessage),
        messages: latestMessages.map(toChatMessageDto),
        activeWorldBookIds,
      });
    } catch (err) {
      if (!clientClosed && !isAbortError(err)) {
        const error =
          err instanceof LlmRequestError ? err.message : 'LLM API request failed';
        writeNdjsonEvent(reply, { type: 'error', error });
      }
    } finally {
      streamFinished = true;
      reply.raw.off('close', abortUpstream);
      endNdjsonReply(reply);
    }
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

    const history = toPromptHistory(savedMessages.slice(0, -2));
    const promptSettings = await getActivePromptSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();
    const prompt = buildPromptMessages({
      character: existing.character,
      worldBooks,
      history,
      userMessage: previousMessage.content,
      promptSettings,
      promptPresetEntries,
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

  app.post('/api/conversations/:id/regenerate/stream', async (req, reply) => {
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

    const history = toPromptHistory(savedMessages.slice(0, -2));
    const promptSettings = await getActivePromptSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();
    const prompt = buildPromptMessages({
      character: existing.character,
      worldBooks,
      history,
      userMessage: previousMessage.content,
      promptSettings,
      promptPresetEntries,
    });
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    startNdjsonReply(reply);

    const upstreamController = new AbortController();
    let clientClosed = false;
    let streamFinished = false;
    const abortUpstream = () => {
      if (streamFinished) return;
      clientClosed = true;
      upstreamController.abort();
    };
    reply.raw.on('close', abortUpstream);

    try {
      const content = await streamAssistantReply({
        app,
        llmSettings,
        messages: prompt.messages,
        signal: upstreamController.signal,
        onDelta: (delta) => writeNdjsonEvent(reply, { type: 'delta', content: delta }),
      });
      if (clientClosed || upstreamController.signal.aborted) return;

      const assistantMessage = await prisma.chatMessage.update({
        where: { id: lastMessage.id },
        data: { content },
      });
      const latestMessages = await getConversationMessages(conversation.id);

      writeNdjsonEvent(reply, {
        type: 'done',
        reply: content,
        conversation: toConversationDto(conversation),
        assistantMessage: toChatMessageDto(assistantMessage),
        messages: latestMessages.map(toChatMessageDto),
        activeWorldBookIds,
      });
    } catch (err) {
      if (!clientClosed && !isAbortError(err)) {
        const error =
          err instanceof LlmRequestError ? err.message : 'LLM API request failed';
        writeNdjsonEvent(reply, { type: 'error', error });
      }
    } finally {
      streamFinished = true;
      reply.raw.off('close', abortUpstream);
      endNdjsonReply(reply);
    }
  });
}
