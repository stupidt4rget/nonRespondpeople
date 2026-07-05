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

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function buildSystemMessage(character: {
  name: string;
  persona: string | null;
  description: string | null;
  scenario: string | null;
  systemPrompt: string | null;
}, worldBooks: { name: string; description: string | null; entriesJson: string }[]): string {
  const parts: string[] = [`You are roleplaying as ${character.name}.`];
  if (character.persona) {
    parts.push(character.persona);
  } else if (character.description) {
    parts.push(character.description);
  }
  if (character.scenario) {
    parts.push(`Scenario: ${character.scenario}`);
  }
  if (character.systemPrompt) {
    parts.push(character.systemPrompt);
  }
  const worldBookText = buildWorldBookPrompt(worldBooks);
  if (worldBookText) {
    parts.push(worldBookText);
  }
  return parts.join('\n\n');
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function entryToText(entry: unknown): string {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const record = entry as Record<string, unknown>;
    const keys = Array.isArray(record.keys)
      ? record.keys.filter((key): key is string => typeof key === 'string').join(', ')
      : '';
    const secondary = Array.isArray(record.secondary_keys)
      ? record.secondary_keys.filter((key): key is string => typeof key === 'string').join(', ')
      : '';
    const content = typeof record.content === 'string' ? record.content : '';
    const comment = typeof record.comment === 'string' ? record.comment : '';
    return [
      keys ? `Keys: ${keys}` : '',
      secondary ? `Secondary keys: ${secondary}` : '',
      comment ? `Comment: ${comment}` : '',
      content,
    ].filter(Boolean).join('\n');
  }
  return typeof entry === 'string' ? entry : JSON.stringify(entry);
}

function buildWorldBookPrompt(
  worldBooks: { name: string; description: string | null; entriesJson: string }[],
): string {
  const maxPerBook = 4000;
  const maxTotal = 12000;
  const chunks: string[] = [];
  let total = 0;

  for (const worldBook of worldBooks) {
    const parsed = parseJson(worldBook.entriesJson);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const entriesText = entries.map(entryToText).filter(Boolean).join('\n\n');
    const text = [
      `Worldbook: ${worldBook.name}`,
      worldBook.description ? `Description: ${worldBook.description}` : '',
      entriesText,
    ].filter(Boolean).join('\n');
    const clipped = clipText(text, maxPerBook);
    if (total + clipped.length > maxTotal) {
      const remaining = maxTotal - total;
      if (remaining > 0) chunks.push(clipText(clipped, remaining));
      break;
    }
    chunks.push(clipped);
    total += clipped.length;
  }

  return chunks.length > 0
    ? `当前启用世界书内容如下，作为角色扮演背景参考：\n\n${chunks.join('\n\n---\n\n')}`
    : '';
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

    const conversation = await getOrCreateCharacterConversation(found.id);
    const savedMessages = await getConversationMessages(conversation.id);
    const activeWorldBookIds = parseWorldBookIds(conversation.activeWorldBookIdsJson);
    const worldBooks = await prisma.worldBook.findMany({
      where: { id: { in: activeWorldBookIds } },
      orderBy: { updatedAt: 'desc' },
    });

    const systemContent = buildSystemMessage(found, worldBooks);
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemContent },
      ...savedMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

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
