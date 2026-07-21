import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  GenerationSettingsDto,
  GenerationTimingDto,
  PromptSettingsDto,
  RegenerateChatResponse,
} from '@roleagent/shared';
import type { Character, Conversation, UserPersona, WorldBook } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  getActiveGenerationSettings,
  getActiveLlmSettings,
  getActivePromptSettings,
} from './settings.js';
import { getActivePromptPresetEntries } from './promptPresets.js';
import {
  ensureConversationReady,
  getConversationMessages,
  getOrCreateCharacterConversation,
  toChatMessageDto,
  toConversationDto,
} from './conversations.js';
import {
  getAssistantVisibleContent,
  splitAssistantMessageParts,
} from '../services/assistantMessageParts.js';
import { buildPromptMessages, type PromptMessage } from '../services/promptBuilder.js';

type ActiveLlmSettings = NonNullable<Awaited<ReturnType<typeof getActiveLlmSettings>>>;
const APPROX_CHARS_PER_TOKEN = 4;

class LlmRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class LlmAbortError extends Error {
  constructor(
    public readonly content = '',
    public readonly firstTokenAt: Date | null = null,
  ) {
    super('LLM request aborted');
  }
}

interface LlmReplyResult {
  content: string;
  firstTokenAt: Date | null;
  completedAt: Date;
  stopped: boolean;
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
  userPersona: UserPersona | null;
}> {
  const readyConversation = await ensureConversationReady(conversation, character);
  const activeWorldBookIds = parseWorldBookIds(readyConversation.activeWorldBookIdsJson);
  const worldBooks = await prisma.worldBook.findMany({
    where: { id: { in: activeWorldBookIds } },
    orderBy: { updatedAt: 'desc' },
  });
  const userPersona = readyConversation.userPersonaId
    ? await prisma.userPersona.findFirst({
        where: {
          id: readyConversation.userPersonaId,
          enabled: true,
        },
      })
    : null;

  return {
    conversation: readyConversation,
    activeWorldBookIds,
    worldBooks,
    userPersona,
  };
}

async function requestAssistantReply(
  app: FastifyInstance,
  llmSettings: ActiveLlmSettings,
  generationSettings: GenerationSettingsDto,
  messages: PromptMessage[],
): Promise<LlmReplyResult> {
  const url = `${llmSettings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let llmRes: Response;
  try {
    llmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmSettings.apiKey}`,
      },
      body: JSON.stringify(
        buildLlmRequestBody({
          model: llmSettings.model,
          messages,
          stream: false,
          generationSettings,
        }),
      ),
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

  const completedAt = new Date();
  return {
    content,
    firstTokenAt: completedAt,
    completedAt,
    stopped: false,
  };
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
  generationSettings: GenerationSettingsDto;
  messages: PromptMessage[];
  signal: AbortSignal;
  onDelta: (content: string) => void;
}): Promise<LlmReplyResult> {
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
        ...buildLlmRequestBody({
          model: args.llmSettings.model,
          messages: args.messages,
          stream: true,
          generationSettings: args.generationSettings,
        }),
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
  let firstTokenAt: Date | null = null;

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
            if (!firstTokenAt) firstTokenAt = new Date();
            content += delta;
            args.onDelta(delta);
          }
        }
        eventEnd = buffer.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw new LlmAbortError(content, firstTokenAt);
    throw err;
  } finally {
    reader.releaseLock();
  }

  if (args.signal.aborted) throw new LlmAbortError(content, firstTokenAt);
  if (!done) {
    throw new LlmRequestError(502, 'LLM API stream ended before completion');
  }

  return {
    content,
    firstTokenAt,
    completedAt: new Date(),
    stopped: false,
  };
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

function buildLlmRequestBody(args: {
  model: string;
  messages: PromptMessage[];
  stream: boolean;
  generationSettings: GenerationSettingsDto;
}) {
  return {
    model: args.model,
    messages: args.messages,
    stream: args.stream,
    max_tokens: args.generationSettings.maxReplyTokens,
    temperature: args.generationSettings.temperature,
    top_p: args.generationSettings.topP,
    frequency_penalty: args.generationSettings.frequencyPenalty,
    presence_penalty: args.generationSettings.presencePenalty,
  };
}

function promptLimitsFromGenerationSettings(
  promptSettings: PromptSettingsDto,
  generationSettings: GenerationSettingsDto,
): {
  maxPromptChars: number;
  historyBudgetChars: number;
  worldBookMaxChars: number;
} {
  const maxPromptChars = generationSettings.contextLimitTokens * APPROX_CHARS_PER_TOKEN;
  return {
    maxPromptChars,
    historyBudgetChars: Math.min(promptSettings.historyBudgetChars, maxPromptChars),
    worldBookMaxChars: Math.min(promptSettings.worldBookBudgetChars, maxPromptChars),
  };
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

function buildTiming(
  startedAt: Date,
  result: LlmReplyResult,
): GenerationTimingDto {
  const firstTokenMs = result.firstTokenAt
    ? result.firstTokenAt.getTime() - startedAt.getTime()
    : null;
  const outputMs = result.firstTokenAt
    ? result.completedAt.getTime() - result.firstTokenAt.getTime()
    : null;
  return {
    startedAt: startedAt.toISOString(),
    firstTokenAt: result.firstTokenAt?.toISOString() ?? null,
    completedAt: result.completedAt.toISOString(),
    firstTokenMs,
    outputMs,
    totalMs: result.completedAt.getTime() - startedAt.getTime(),
    stopped: result.stopped,
  };
}

function assistantDataFromContent(args: {
  content: string;
  timing: GenerationTimingDto;
  promptDebugJson: string;
}) {
  const parts = splitAssistantMessageParts(args.content);
  return {
    content: args.content,
    rawContent: args.content,
    thinkingContent:
      parts.thinkingBlocks.length > 0 ? parts.thinkingBlocks.join('\n\n') : null,
    timingJson: JSON.stringify(args.timing),
    promptDebugJson: args.promptDebugJson,
  };
}

async function createAssistantMessageWithVariant(args: {
  conversationId: string;
  content: string;
  timing: GenerationTimingDto;
  promptDebugJson: string;
  generationSettings: GenerationSettingsDto;
}) {
  const assistantData = assistantDataFromContent({
    content: args.content,
    timing: args.timing,
    promptDebugJson: args.promptDebugJson,
  });
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversationId: args.conversationId,
      role: 'assistant',
      ...assistantData,
    },
  });
  const variant = await prisma.assistantMessageVariant.create({
    data: {
      messageId: assistantMessage.id,
      content: assistantData.content,
      rawContent: assistantData.rawContent,
      thinkingContent: assistantData.thinkingContent,
      timingJson: assistantData.timingJson,
      generationSettingsJson: JSON.stringify(args.generationSettings),
    },
  });
  return prisma.chatMessage.update({
    where: { id: assistantMessage.id },
    data: { selectedVariantId: variant.id },
    include: {
      variants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

async function ensureCurrentAssistantVariant(
  message: {
    id: string;
    content: string;
    rawContent: string | null;
    thinkingContent: string | null;
    timingJson: string | null;
    selectedVariantId: string | null;
  },
  generationSettings: GenerationSettingsDto,
): Promise<string> {
  if (message.selectedVariantId) return message.selectedVariantId;
  const variant = await prisma.assistantMessageVariant.create({
    data: {
      messageId: message.id,
      content: message.content,
      rawContent: message.rawContent ?? message.content,
      thinkingContent: message.thinkingContent,
      timingJson: message.timingJson,
      generationSettingsJson: JSON.stringify(generationSettings),
    },
  });
  await prisma.chatMessage.update({
    where: { id: message.id },
    data: { selectedVariantId: variant.id },
  });
  return variant.id;
}

async function replaceAssistantWithVariant(args: {
  message: {
    id: string;
    content: string;
    rawContent: string | null;
    thinkingContent: string | null;
    timingJson: string | null;
    selectedVariantId: string | null;
  };
  content: string;
  timing: GenerationTimingDto;
  promptDebugJson: string;
  generationSettings: GenerationSettingsDto;
}) {
  await ensureCurrentAssistantVariant(args.message, args.generationSettings);
  const assistantData = assistantDataFromContent({
    content: args.content,
    timing: args.timing,
    promptDebugJson: args.promptDebugJson,
  });
  const variant = await prisma.assistantMessageVariant.create({
    data: {
      messageId: args.message.id,
      content: assistantData.content,
      rawContent: assistantData.rawContent,
      thinkingContent: assistantData.thinkingContent,
      timingJson: assistantData.timingJson,
      generationSettingsJson: JSON.stringify(args.generationSettings),
    },
  });
  return prisma.chatMessage.update({
    where: { id: args.message.id },
    data: {
      ...assistantData,
      selectedVariantId: variant.id,
    },
    include: {
      variants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
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

    const llmSettings = await getActiveLlmSettings();
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
      userPersona,
    } = await loadPromptContext(found, createdConversation);
    const savedMessages = await getConversationMessages(conversation.id);
    const promptSettings = await getActivePromptSettings();
    const generationSettings = await getActiveGenerationSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();

    const prompt = buildPromptMessages({
      character: found,
      worldBooks,
      history: toPromptHistory(savedMessages),
      userMessage: message.trim(),
      promptSettings,
      promptPresetEntries,
      generationSettings,
      activeUserPersona: userPersona,
      limits: promptLimitsFromGenerationSettings(promptSettings, generationSettings),
    });
    const messages = prompt.messages;
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    let result: LlmReplyResult;
    const startedAt = new Date();
    try {
      result = await requestAssistantReply(app, llmSettings, generationSettings, messages);
    } catch (err) {
      return sendLlmError(reply, err);
    }
    const timing = buildTiming(startedAt, result);
    const promptDebugJson = JSON.stringify(prompt.debug.assembly);

    const userMessage = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message.trim(),
      },
    });
    const assistantMessage = await createAssistantMessageWithVariant({
      conversationId: conversation.id,
      content: result.content,
      timing,
      promptDebugJson,
      generationSettings,
    });
    const latestMessages = await getConversationMessages(conversation.id);

    const body: ChatResponse = {
      reply: result.content,
      conversation: toConversationDto(conversation, userPersona),
      userMessage: toChatMessageDto(userMessage),
      assistantMessage: toChatMessageDto(assistantMessage),
      messages: latestMessages.map(toChatMessageDto),
      activeWorldBookIds,
      promptDebug: prompt.debug.assembly,
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

    const llmSettings = await getActiveLlmSettings();
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
      userPersona,
    } = await loadPromptContext(found, createdConversation);
    const savedMessages = await getConversationMessages(conversation.id);
    const promptSettings = await getActivePromptSettings();
    const generationSettings = await getActiveGenerationSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();

    const prompt = buildPromptMessages({
      character: found,
      worldBooks,
      history: toPromptHistory(savedMessages),
      userMessage: message.trim(),
      promptSettings,
      promptPresetEntries,
      generationSettings,
      activeUserPersona: userPersona,
      limits: promptLimitsFromGenerationSettings(promptSettings, generationSettings),
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

    const startedAt = new Date();
    const promptDebugJson = JSON.stringify(prompt.debug.assembly);
    try {
      const result = await streamAssistantReply({
        app,
        llmSettings,
        generationSettings,
        messages: prompt.messages,
        signal: upstreamController.signal,
        onDelta: (delta) => writeNdjsonEvent(reply, { type: 'delta', content: delta }),
      });
      const timing = buildTiming(startedAt, result);
      if (clientClosed || upstreamController.signal.aborted) return;

      const userMessage = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message.trim(),
        },
      });
      const assistantMessage = await createAssistantMessageWithVariant({
        conversationId: conversation.id,
        content: result.content,
        timing,
        promptDebugJson,
        generationSettings,
      });
      const latestMessages = await getConversationMessages(conversation.id);

      writeNdjsonEvent(reply, {
        type: 'done',
        reply: result.content,
        conversation: toConversationDto(conversation, userPersona),
        userMessage: toChatMessageDto(userMessage),
        assistantMessage: toChatMessageDto(assistantMessage),
        messages: latestMessages.map(toChatMessageDto),
        activeWorldBookIds,
        promptDebug: prompt.debug.assembly,
      });
    } catch (err) {
      if (err instanceof LlmAbortError && err.content.trim() !== '') {
        const stoppedResult: LlmReplyResult = {
          content: err.content,
          firstTokenAt: err.firstTokenAt,
          completedAt: new Date(),
          stopped: true,
        };
        const timing = buildTiming(startedAt, stoppedResult);
        const userMessage = await prisma.chatMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'user',
            content: message.trim(),
          },
        });
        const assistantMessage = await createAssistantMessageWithVariant({
          conversationId: conversation.id,
          content: err.content,
          timing,
          promptDebugJson,
          generationSettings,
        });
        if (!clientClosed) {
          const latestMessages = await getConversationMessages(conversation.id);
          writeNdjsonEvent(reply, {
            type: 'done',
            reply: err.content,
            conversation: toConversationDto(conversation, userPersona),
            userMessage: toChatMessageDto(userMessage),
            assistantMessage: toChatMessageDto(assistantMessage),
            messages: latestMessages.map(toChatMessageDto),
            activeWorldBookIds,
            promptDebug: prompt.debug.assembly,
          });
        }
        return;
      }
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

    const llmSettings = await getActiveLlmSettings();
    if (!llmSettings) {
      return reply
        .code(500)
        .send({ error: 'LLM is not configured on the server' });
    }

    const {
      conversation,
      activeWorldBookIds,
      worldBooks,
      userPersona,
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
    const generationSettings = await getActiveGenerationSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();
    const prompt = buildPromptMessages({
      character: existing.character,
      worldBooks,
      history,
      userMessage: previousMessage.content,
      promptSettings,
      promptPresetEntries,
      generationSettings,
      activeUserPersona: userPersona,
      limits: promptLimitsFromGenerationSettings(promptSettings, generationSettings),
    });
    if (process.env.ROLEAGENT_PROMPT_DEBUG === '1') {
      app.log.info({ prompt: prompt.debug }, 'prompt builder summary');
    }

    let result: LlmReplyResult;
    const startedAt = new Date();
    try {
      result = await requestAssistantReply(
        app,
        llmSettings,
        generationSettings,
        prompt.messages,
      );
    } catch (err) {
      return sendLlmError(reply, err);
    }
    const timing = buildTiming(startedAt, result);
    const promptDebugJson = JSON.stringify(prompt.debug.assembly);

    const assistantMessage = await replaceAssistantWithVariant({
      message: lastMessage,
      content: result.content,
      timing,
      promptDebugJson,
      generationSettings,
    });
    const latestMessages = await getConversationMessages(conversation.id);

    const body: RegenerateChatResponse = {
      reply: result.content,
      conversation: toConversationDto(conversation, userPersona),
      assistantMessage: toChatMessageDto(assistantMessage),
      messages: latestMessages.map(toChatMessageDto),
      activeWorldBookIds,
      promptDebug: prompt.debug.assembly,
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

    const llmSettings = await getActiveLlmSettings();
    if (!llmSettings) {
      return reply
        .code(500)
        .send({ error: 'LLM is not configured on the server' });
    }

    const {
      conversation,
      activeWorldBookIds,
      worldBooks,
      userPersona,
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
    const generationSettings = await getActiveGenerationSettings();
    const promptPresetEntries = await getActivePromptPresetEntries();
    const prompt = buildPromptMessages({
      character: existing.character,
      worldBooks,
      history,
      userMessage: previousMessage.content,
      promptSettings,
      promptPresetEntries,
      generationSettings,
      activeUserPersona: userPersona,
      limits: promptLimitsFromGenerationSettings(promptSettings, generationSettings),
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

    const startedAt = new Date();
    const promptDebugJson = JSON.stringify(prompt.debug.assembly);
    try {
      const result = await streamAssistantReply({
        app,
        llmSettings,
        generationSettings,
        messages: prompt.messages,
        signal: upstreamController.signal,
        onDelta: (delta) => writeNdjsonEvent(reply, { type: 'delta', content: delta }),
      });
      const timing = buildTiming(startedAt, result);
      if (clientClosed || upstreamController.signal.aborted) return;

      const assistantMessage = await replaceAssistantWithVariant({
        message: lastMessage,
        content: result.content,
        timing,
        promptDebugJson,
        generationSettings,
      });
      const latestMessages = await getConversationMessages(conversation.id);

      writeNdjsonEvent(reply, {
        type: 'done',
        reply: result.content,
        conversation: toConversationDto(conversation, userPersona),
        assistantMessage: toChatMessageDto(assistantMessage),
        messages: latestMessages.map(toChatMessageDto),
        activeWorldBookIds,
        promptDebug: prompt.debug.assembly,
      });
    } catch (err) {
      if (err instanceof LlmAbortError && err.content.trim() !== '') {
        const stoppedResult: LlmReplyResult = {
          content: err.content,
          firstTokenAt: err.firstTokenAt,
          completedAt: new Date(),
          stopped: true,
        };
        const timing = buildTiming(startedAt, stoppedResult);
        const assistantMessage = await replaceAssistantWithVariant({
          message: lastMessage,
          content: err.content,
          timing,
          promptDebugJson,
          generationSettings,
        });
        if (!clientClosed) {
          const latestMessages = await getConversationMessages(conversation.id);
          writeNdjsonEvent(reply, {
            type: 'done',
            reply: err.content,
            conversation: toConversationDto(conversation, userPersona),
            assistantMessage: toChatMessageDto(assistantMessage),
            messages: latestMessages.map(toChatMessageDto),
            activeWorldBookIds,
            promptDebug: prompt.debug.assembly,
          });
        }
        return;
      }
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
