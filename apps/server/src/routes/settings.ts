import type { FastifyInstance } from 'fastify';
import type {
  GenerationSettingsDto,
  GenerationSettingsRequest,
  LlmSettingsRequest,
  LlmSettingsStatusResponse,
  PromptSettingsDto,
  PromptSettingsRequest,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';

interface ActiveLlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const PROMPT_SETTINGS_ID = 'default';
const GENERATION_SETTINGS_ID = 'default';
const LLM_SETTINGS_ID = 'default';
const DEFAULT_ROLEPLAY_PRESET = [
  'Stay in character as {{char}}.',
  'Maintain continuity with the character card, worldbook, and conversation.',
  'Respond as {{char}}, not as an assistant outside the scene.',
  'Use natural dialogue and action when appropriate.',
  'Do not summarize unless asked.',
  'Avoid meta commentary.',
].join('\n');
const DEFAULT_PROMPT_SETTINGS: PromptSettingsDto = {
  roleplayPreset: DEFAULT_ROLEPLAY_PRESET,
  userPersona: null,
  authorsNote: null,
  userName: 'User',
  maxPromptChars: 24000,
  historyBudgetChars: 12000,
  worldBookBudgetChars: 6000,
  worldBookScanDepth: 3,
};
const DEFAULT_GENERATION_SETTINGS: GenerationSettingsDto = {
  contextUnlockEnabled: false,
  contextLimitTokens: 200000,
  maxReplyTokens: 65536,
  responseCount: 1,
  streamEnabled: true,
  visibleThinkingEnabled: true,
  temperature: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  topP: 1,
};

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function getEnvSettings(): ActiveLlmSettings | null {
  const baseUrl = process.env.LLM_API_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim();

  if (!baseUrl || !apiKey || !model) {
    return null;
  }

  return { baseUrl, apiKey, model };
}

export async function getActiveLlmSettings(): Promise<ActiveLlmSettings | null> {
  const saved = await prisma.llmSettings.findUnique({
    where: { id: LLM_SETTINGS_ID },
  });
  if (saved?.apiKey) {
    return {
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiKey: saved.apiKey,
    };
  }
  return getEnvSettings();
}

export async function getActivePromptSettings(): Promise<PromptSettingsDto> {
  const found = await prisma.promptSettings.findUnique({
    where: { id: PROMPT_SETTINGS_ID },
  });
  if (!found) {
    return DEFAULT_PROMPT_SETTINGS;
  }

  return {
    roleplayPreset: found.roleplayPreset,
    userPersona: found.userPersona,
    authorsNote: found.authorsNote,
    userName: found.userName,
    maxPromptChars: found.maxPromptChars,
    historyBudgetChars: found.historyBudgetChars,
    worldBookBudgetChars: found.worldBookBudgetChars,
    worldBookScanDepth: found.worldBookScanDepth,
  };
}

export async function getActiveGenerationSettings(): Promise<GenerationSettingsDto> {
  const found = await prisma.generationSettings.findUnique({
    where: { id: GENERATION_SETTINGS_ID },
  });
  if (!found) {
    return DEFAULT_GENERATION_SETTINGS;
  }

  return {
    contextUnlockEnabled: found.contextUnlockEnabled,
    contextLimitTokens: found.contextLimitTokens,
    maxReplyTokens: found.maxReplyTokens,
    responseCount: found.responseCount,
    streamEnabled: found.streamEnabled,
    visibleThinkingEnabled: found.visibleThinkingEnabled,
    temperature: found.temperature,
    frequencyPenalty: found.frequencyPenalty,
    presencePenalty: found.presencePenalty,
    topP: found.topP,
  };
}

async function getLlmSettingsStatus(): Promise<LlmSettingsStatusResponse> {
  const saved = await prisma.llmSettings.findUnique({
    where: { id: LLM_SETTINGS_ID },
  });
  if (saved) {
    return {
      configured: saved.apiKey !== null && saved.apiKey.trim() !== '',
      source: 'database',
      baseUrl: saved.baseUrl,
      model: saved.model,
      hasApiKey: saved.apiKey !== null && saved.apiKey.trim() !== '',
    };
  }

  const envSettings = getEnvSettings();
  if (envSettings) {
    return {
      configured: true,
      source: 'env',
      baseUrl: envSettings.baseUrl,
      model: envSettings.model,
      hasApiKey: true,
    };
  }

  return {
    configured: false,
    source: 'none',
    baseUrl: null,
    model: null,
    hasApiKey: false,
  };
}

function trimNullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function trimRequiredText(value: unknown): string | undefined {
  if (value === undefined || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizePromptSettingsRequest(
  body: PromptSettingsRequest,
  current: PromptSettingsDto,
): PromptSettingsDto {
  const roleplayPreset =
    trimRequiredText(body.roleplayPreset) ?? current.roleplayPreset;
  const userName =
    trimRequiredText(body.userName) ?? current.userName;
  const userPersona = trimNullableText(body.userPersona);
  const authorsNote = trimNullableText(body.authorsNote);

  return {
    roleplayPreset,
    userPersona: userPersona === undefined ? current.userPersona : userPersona,
    authorsNote: authorsNote === undefined ? current.authorsNote : authorsNote,
    userName,
    maxPromptChars: boundedInteger(
      body.maxPromptChars,
      current.maxPromptChars,
      4000,
      200000,
    ),
    historyBudgetChars: boundedInteger(
      body.historyBudgetChars,
      current.historyBudgetChars,
      0,
      160000,
    ),
    worldBookBudgetChars: boundedInteger(
      body.worldBookBudgetChars,
      current.worldBookBudgetChars,
      0,
      80000,
    ),
    worldBookScanDepth: boundedInteger(
      body.worldBookScanDepth,
      current.worldBookScanDepth,
      1,
      20,
    ),
  };
}

function normalizeGenerationSettingsRequest(
  body: GenerationSettingsRequest,
  current: GenerationSettingsDto,
): GenerationSettingsDto {
  if (body.responseCount !== undefined && body.responseCount !== 1) {
    throw new Error('responseCount currently only supports 1');
  }

  const contextUnlockEnabled =
    typeof body.contextUnlockEnabled === 'boolean'
      ? body.contextUnlockEnabled
      : current.contextUnlockEnabled;
  const streamEnabled =
    typeof body.streamEnabled === 'boolean'
      ? body.streamEnabled
      : current.streamEnabled;
  const visibleThinkingEnabled =
    typeof body.visibleThinkingEnabled === 'boolean'
      ? body.visibleThinkingEnabled
      : current.visibleThinkingEnabled;
  const contextMax = contextUnlockEnabled ? 2000000 : 200000;
  const contextLimitTokens =
    typeof body.contextLimitTokens === 'number'
      ? body.contextLimitTokens
      : current.contextLimitTokens;

  return {
    contextUnlockEnabled,
    contextLimitTokens: boundedInteger(
      contextLimitTokens,
      current.contextLimitTokens,
      1024,
      contextMax,
    ),
    maxReplyTokens: boundedInteger(
      body.maxReplyTokens,
      current.maxReplyTokens,
      1,
      128000,
    ),
    responseCount: 1,
    streamEnabled,
    visibleThinkingEnabled,
    temperature: boundedNumber(body.temperature, current.temperature, 0, 2),
    frequencyPenalty: boundedNumber(
      body.frequencyPenalty,
      current.frequencyPenalty,
      -2,
      2,
    ),
    presencePenalty: boundedNumber(
      body.presencePenalty,
      current.presencePenalty,
      -2,
      2,
    ),
    topP: boundedNumber(body.topP, current.topP, 0, 1),
  };
}

async function savePromptSettings(
  settings: PromptSettingsDto,
): Promise<PromptSettingsDto> {
  const saved = await prisma.promptSettings.upsert({
    where: { id: PROMPT_SETTINGS_ID },
    create: {
      id: PROMPT_SETTINGS_ID,
      ...settings,
    },
    update: settings,
  });

  return {
    roleplayPreset: saved.roleplayPreset,
    userPersona: saved.userPersona,
    authorsNote: saved.authorsNote,
    userName: saved.userName,
    maxPromptChars: saved.maxPromptChars,
    historyBudgetChars: saved.historyBudgetChars,
    worldBookBudgetChars: saved.worldBookBudgetChars,
    worldBookScanDepth: saved.worldBookScanDepth,
  };
}

async function saveGenerationSettings(
  settings: GenerationSettingsDto,
): Promise<GenerationSettingsDto> {
  const saved = await prisma.generationSettings.upsert({
    where: { id: GENERATION_SETTINGS_ID },
    create: {
      id: GENERATION_SETTINGS_ID,
      ...settings,
    },
    update: settings,
  });

  return {
    contextUnlockEnabled: saved.contextUnlockEnabled,
    contextLimitTokens: saved.contextLimitTokens,
    maxReplyTokens: saved.maxReplyTokens,
    responseCount: saved.responseCount,
    streamEnabled: saved.streamEnabled,
    visibleThinkingEnabled: saved.visibleThinkingEnabled,
    temperature: saved.temperature,
    frequencyPenalty: saved.frequencyPenalty,
    presencePenalty: saved.presencePenalty,
    topP: saved.topP,
  };
}

async function saveLlmSettings(
  body: LlmSettingsRequest,
): Promise<LlmSettingsStatusResponse> {
  const { baseUrl, model, apiKey, clearApiKey } = body;
  const existing = await prisma.llmSettings.findUnique({
    where: { id: LLM_SETTINGS_ID },
  });
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const nextApiKey =
    clearApiKey === true
      ? null
      : trimmedApiKey !== ''
        ? trimmedApiKey
        : existing?.apiKey ?? null;

  await prisma.llmSettings.upsert({
    where: { id: LLM_SETTINGS_ID },
    create: {
      id: LLM_SETTINGS_ID,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: nextApiKey,
    },
    update: {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: nextApiKey,
    },
  });

  return getLlmSettingsStatus();
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/llm', async () => {
    return getLlmSettingsStatus();
  });

  app.get('/api/settings/prompt', async () => {
    return getActivePromptSettings();
  });

  app.get('/api/settings/generation', async () => {
    return getActiveGenerationSettings();
  });

  app.put('/api/settings/prompt', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const current = await getActivePromptSettings();
    const next = normalizePromptSettingsRequest(
      req.body as PromptSettingsRequest,
      current,
    );
    return savePromptSettings(next);
  });

  app.post('/api/settings/prompt/reset', async () => {
    return savePromptSettings(DEFAULT_PROMPT_SETTINGS);
  });

  app.put('/api/settings/generation', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const current = await getActiveGenerationSettings();
    try {
      const next = normalizeGenerationSettingsRequest(
        req.body as GenerationSettingsRequest,
        current,
      );
      return saveGenerationSettings(next);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/settings/generation/reset', async () => {
    return saveGenerationSettings(DEFAULT_GENERATION_SETTINGS);
  });

  app.post('/api/settings/llm', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const body = req.body as LlmSettingsRequest;
    const { baseUrl, model } = body;
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'baseUrl is required and must be a non-empty string' });
    }
    if (typeof model !== 'string' || model.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'model is required and must be a non-empty string' });
    }

    return saveLlmSettings(body);
  });

  app.put('/api/settings/llm', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const body = req.body as LlmSettingsRequest;
    const { baseUrl, model } = body;
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'baseUrl is required and must be a non-empty string' });
    }
    if (typeof model !== 'string' || model.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'model is required and must be a non-empty string' });
    }

    return saveLlmSettings(body);
  });
}
