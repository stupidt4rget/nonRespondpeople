import type { FastifyInstance } from 'fastify';
import type { ChatRequest, ChatResponse } from '@roleagent/shared';
import { prisma } from '../db/prisma.js';

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
}): string {
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
  return parts.join('\n\n');
}

function extractHistory(history: unknown): { role: string; content: string }[] {
  if (!Array.isArray(history)) return [];
  const result: { role: string; content: string }[] = [];
  for (const item of history) {
    if (
      item !== null &&
      typeof item === 'object' &&
      'role' in item &&
      'content' in item
    ) {
      const role = (item as { role: unknown }).role;
      const content = (item as { content: unknown }).content;
      if (
        (role === 'user' || role === 'assistant') &&
        typeof content === 'string'
      ) {
        result.push({ role, content });
      }
    }
  }
  return result;
}

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const { characterId, message, history } = req.body as ChatRequest;

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

    const baseUrl = process.env.LLM_API_BASE_URL;
    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL;

    if (!baseUrl || !apiKey || !model) {
      return reply
        .code(500)
        .send({ error: 'LLM is not configured on the server' });
    }

    const systemContent = buildSystemMessage(found);
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemContent },
      ...extractHistory(history),
      { role: 'user', content: message },
    ];

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let llmRes: Response;
    try {
      llmRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: false }),
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

    const body: ChatResponse = { reply: content };
    return reply.send(body);
  });
}
