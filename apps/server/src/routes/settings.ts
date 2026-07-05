import type { FastifyInstance } from 'fastify';
import type {
  LlmSettingsRequest,
  LlmSettingsStatusResponse,
} from '@roleagent/shared';

interface ActiveLlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

let memoryLlmSettings: ActiveLlmSettings | null = null;

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

export function getActiveLlmSettings(): ActiveLlmSettings | null {
  return memoryLlmSettings ?? getEnvSettings();
}

function getLlmSettingsStatus(): LlmSettingsStatusResponse {
  if (memoryLlmSettings) {
    return {
      configured: true,
      source: 'memory',
      baseUrl: memoryLlmSettings.baseUrl,
      model: memoryLlmSettings.model,
      hasApiKey: true,
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

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/llm', async () => {
    return getLlmSettingsStatus();
  });

  app.post('/api/settings/llm', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    const { baseUrl, model, apiKey } = req.body as LlmSettingsRequest;
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
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      return reply
        .code(400)
        .send({ error: 'apiKey is required and must be a non-empty string' });
    }

    memoryLlmSettings = {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: apiKey.trim(),
    };

    return getLlmSettingsStatus();
  });
}
