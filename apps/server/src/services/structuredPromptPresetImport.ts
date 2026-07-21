import type {
  PromptPresetCandidate,
  PromptPresetEntryDto,
  PromptPresetEntryRole,
  PromptPresetExportResponse,
  PromptPresetImportPreviewResponse,
  PromptPresetSourceType,
} from '@roleagent/shared';

export class PromptPresetImportError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_IMPORT_JSON_CHARS = 10 * 1024 * 1024;
const MAX_PRESET_ENTRY_CHARS = 200000;
const PREVIEW_ENTRY_CHARS = 400;

const SENSITIVE_KEY_PATTERNS = [
  'author' + 'ization',
  'api_key',
  'apikey',
  'proxy_password',
  'custom_include_headers',
  'reverse_proxy',
  'custom_url',
];

const SENSITIVE_VALUE_PATTERNS = [
  'author' + 'ization',
  'bear' + 'er',
  'sk' + '-',
  'ark' + '-',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.replaceAll('\0', '');
}

function optionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function fileNameToDisplayName(fileName: string | undefined): string | null {
  const name = optionalString(fileName);
  if (!name) return null;
  return name.replace(/\.[^.]+$/, '').trim() || null;
}

function normalizeRole(value: unknown): PromptPresetEntryRole {
  const role = optionalString(value)?.toLowerCase();
  if (role === 'user' || role === 'assistant') return role;
  return 'system';
}

function makeEntry(args: {
  index: number;
  identifier?: string | null;
  name?: string | null;
  role?: unknown;
  enabled?: boolean;
  content?: string | null;
  marker?: boolean;
  injectionPosition?: string | null;
  injectionDepth?: number | null;
  injectionOrder?: number | null;
}): PromptPresetEntryDto {
  return {
    id: `preview-${args.index + 1}`,
    identifier: args.identifier ?? null,
    name: args.name ?? `Prompt ${args.index + 1}`,
    role: normalizeRole(args.role),
    enabled: args.enabled ?? true,
    content: args.content ?? '',
    orderIndex: args.index,
    marker: args.marker ?? false,
    injectionPosition: args.injectionPosition ?? null,
    injectionDepth: args.injectionDepth ?? null,
    injectionOrder: args.injectionOrder ?? null,
  };
}

function assertImportSize(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new PromptPresetImportError(
      400,
      'invalid_json',
      'Prompt preset import requires a JSON object.',
    );
  }
  if (serialized.length > MAX_IMPORT_JSON_CHARS) {
    throw new PromptPresetImportError(
      413,
      'payload_too_large',
      'Prompt preset JSON is too large. Maximum supported size is 10 MB.',
    );
  }
}

function collectSensitiveFindings(value: unknown): string[] {
  const findings: string[] = [];
  const visit = (current: unknown, path: string, depth: number) => {
    if (depth > 20) {
      findings.push(`${path || '$'} exceeds maximum nesting depth`);
      return;
    }
    if (typeof current === 'string') {
      const lower = current.toLowerCase();
      for (const pattern of SENSITIVE_VALUE_PATTERNS) {
        if (lower.includes(pattern)) {
          findings.push(`${path || '$'} contains sensitive-looking text`);
          break;
        }
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(current)) return;
    for (const [key, item] of Object.entries(current)) {
      const keyPath = path ? `${path}.${key}` : key;
      const normalizedKey = key.toLowerCase();
      for (const pattern of SENSITIVE_KEY_PATTERNS) {
        if (normalizedKey.includes(pattern)) {
          findings.push(`${keyPath} is not supported for prompt preset import`);
          break;
        }
      }
      visit(item, keyPath, depth + 1);
    }
  };

  visit(value, '', 0);
  return [...new Set(findings)];
}

export function assertNoSensitiveContent(value: unknown): void {
  const findings = collectSensitiveFindings(value);
  if (findings.length > 0) {
    throw new PromptPresetImportError(
      422,
      'sensitive_content_detected',
      `Sensitive or connection-related fields were detected: ${findings.join(', ')}`,
    );
  }
}

function ignoredFields(input: Record<string, unknown>, supported: string[]): string[] {
  const supportedSet = new Set(supported);
  const hiddenPreviewKeyPatterns = [
    'temp',
    'temperature',
    'top_',
    'rep_pen',
    'penalty',
    'min_p',
    'top_p',
    'top_a',
    'max_tokens',
    'max_context',
    'model',
    'openai',
    'proxy',
    'header',
    'url',
    'key',
    'extension',
    'function',
    'web_search',
    'image',
    'media',
    'reasoning',
    'request',
    'bias',
    'seed',
    'stream',
  ];
  const hiddenPreviewKeys = new Set(['n']);

  return Object.keys(input)
    .filter((key) => !supportedSet.has(key))
    .filter((key) => {
      const normalizedKey = key.toLowerCase();
      return (
        !hiddenPreviewKeys.has(normalizedKey) &&
        !hiddenPreviewKeyPatterns.some((pattern) => normalizedKey.includes(pattern))
      );
    })
    .sort();
}

function makePreview(candidate: PromptPresetCandidate, skippedCount = 0): PromptPresetImportPreviewResponse {
  const entriesPreview = candidate.entries.slice(0, 50).map((entry) => ({
    ...entry,
    content: clip(entry.content.replace(/\s+/g, ' ').trim(), PREVIEW_ENTRY_CHARS),
  }));

  return {
    candidate,
    recognizedAs: candidate.sourceType,
    entriesPreview,
    warnings: candidate.warnings,
    ignoredFields: candidate.ignoredFields,
    willCreateEntryCount: candidate.entries.length,
    willSkipCount: skippedCount,
  };
}

function parseRoleAgentPreset(
  input: Record<string, unknown>,
  fileName?: string,
): { candidate: PromptPresetCandidate; skippedCount: number } | null {
  const format = optionalString(input.format);
  if (format === 'roleagent-structured-prompt-preset' && Array.isArray(input.entries)) {
    const entries = input.entries
      .map((item, index) => {
        if (!isRecord(item)) return null;
        return makeEntry({
          index,
          identifier: optionalString(item.identifier),
          name: optionalString(item.name),
          role: item.role,
          enabled: item.enabled !== false,
          content: optionalString(item.content) ?? '',
          marker: item.marker === true,
          injectionPosition: optionalString(item.injectionPosition),
          injectionDepth: optionalInteger(item.injectionDepth),
          injectionOrder: optionalInteger(item.injectionOrder),
        });
      })
      .filter((entry): entry is PromptPresetEntryDto => entry !== null);
    if (entries.length === 0) {
      throw new PromptPresetImportError(
        422,
        'empty_prompt_preset',
        'RoleAgent prompt preset has no entries to import.',
      );
    }

    return {
      candidate: {
        name: optionalString(input.name) ?? fileNameToDisplayName(fileName) ?? 'Imported Prompt Preset',
        sourceType: 'roleagent',
        entries,
        warnings: [],
        ignoredFields: ignoredFields(input, ['format', 'version', 'name', 'sourceType', 'entries', 'exportedAt']),
        originalFileName: optionalString(fileName),
      },
      skippedCount: 0,
    };
  }

  const roleplayPreset = optionalString(input.roleplayPreset);
  if (!roleplayPreset) return null;

  return {
    candidate: {
      name: optionalString(input.name) ?? fileNameToDisplayName(fileName) ?? 'Imported RoleAgent Prompt',
      sourceType: 'roleagent',
      entries: [
        makeEntry({
          index: 0,
          identifier: 'roleplayPreset',
          name: 'Roleplay Prompt Preset',
          role: 'system',
          content: roleplayPreset,
        }),
      ],
      warnings: ['Imported legacy RoleAgent roleplayPreset as one structured system entry.'],
      ignoredFields: ignoredFields(input, ['format', 'version', 'name', 'roleplayPreset', 'exportedAt']),
      originalFileName: optionalString(fileName),
    },
    skippedCount: 0,
  };
}

function parseSystemPromptPreset(
  input: Record<string, unknown>,
  fileName?: string,
): { candidate: PromptPresetCandidate; skippedCount: number } | null {
  const content =
    optionalString(input.content) ??
    optionalString(input.system_prompt) ??
    optionalString(input.sysprompt) ??
    optionalString(input.main_prompt);
  if (!content) return null;

  return {
    candidate: {
      name: optionalString(input.name) ?? fileNameToDisplayName(fileName) ?? 'Imported System Prompt',
      sourceType: 'st-sysprompt',
      entries: [
        makeEntry({
          index: 0,
          identifier: 'system',
          name: optionalString(input.name) ?? 'System Prompt',
          role: 'system',
          content,
        }),
      ],
      warnings: [],
      ignoredFields: ignoredFields(input, ['name', 'content', 'system_prompt', 'sysprompt', 'main_prompt']),
      originalFileName: optionalString(fileName),
    },
    skippedCount: 0,
  };
}

function parseOpenAiPromptListPreset(
  input: Record<string, unknown>,
  fileName?: string,
): { candidate: PromptPresetCandidate; skippedCount: number } | null {
  if (!Array.isArray(input.prompts) || !Array.isArray(input.prompt_order)) {
    return null;
  }

  const firstPromptOrder = input.prompt_order[0];
  if (!isRecord(firstPromptOrder) || !Array.isArray(firstPromptOrder.order)) {
    return null;
  }

  const promptsByIdentifier = new Map<string, Record<string, unknown>>();
  for (const prompt of input.prompts) {
    if (!isRecord(prompt)) continue;
    const identifier = optionalString(prompt.identifier);
    if (!identifier || promptsByIdentifier.has(identifier)) continue;
    promptsByIdentifier.set(identifier, prompt);
  }

  let skippedCount = 0;
  const entries: PromptPresetEntryDto[] = [];
  for (const orderItem of firstPromptOrder.order) {
    if (!isRecord(orderItem)) {
      skippedCount += 1;
      continue;
    }

    const identifier = optionalString(orderItem.identifier);
    const prompt = identifier ? promptsByIdentifier.get(identifier) : undefined;
    if (!prompt) {
      skippedCount += 1;
      continue;
    }

    const orderIndex = entries.length;
    entries.push(makeEntry({
      index: orderIndex,
      identifier,
      name: optionalString(prompt.name) ?? identifier ?? `Prompt ${orderIndex + 1}`,
      role: prompt.role,
      enabled: orderItem.enabled !== false && prompt.enabled !== false,
      content: optionalString(prompt.content) ?? '',
      marker: prompt.marker === true,
      injectionPosition:
        optionalString(prompt.injection_position) ??
        optionalString(prompt.injectionPosition),
      injectionDepth:
        optionalInteger(prompt.injection_depth) ??
        optionalInteger(prompt.injectionDepth),
      injectionOrder:
        optionalInteger(prompt.injection_order) ??
        optionalInteger(prompt.injectionOrder),
    }));
  }

  if (entries.length === 0) {
    throw new PromptPresetImportError(
      422,
      'empty_prompt_list',
      'OpenAI prompt list preset has no matching prompt entries to import.',
    );
  }

  const warnings = [
    'Imported SillyTavern prompt list as structured Prompt Preset entries.',
    'Marker/depth injection metadata is preserved for display but SillyTavern marker assembly is not replicated.',
    'Sampling, model, API, proxy, header, and extension settings were not imported.',
  ];
  if (skippedCount > 0) {
    warnings.push(`${skippedCount} prompt order item(s) were skipped because no prompt item could be matched.`);
  }

  return {
    candidate: {
      name: fileNameToDisplayName(fileName) ?? 'Imported OpenAI Prompt List',
      sourceType: 'st-openai-prompt-list',
      entries,
      warnings,
      ignoredFields: ignoredFields(input, ['prompts', 'prompt_order', 'name']),
      originalFileName: optionalString(fileName),
    },
    skippedCount,
  };
}

function parseOpenAiMainPreset(
  input: Record<string, unknown>,
  fileName?: string,
): { candidate: PromptPresetCandidate; skippedCount: number } | null {
  if (!Array.isArray(input.prompts)) return null;

  const mainPrompt = input.prompts.find((item) => {
    if (!isRecord(item)) return false;
    return item.identifier === 'main' && item.marker !== true;
  });
  if (!isRecord(mainPrompt)) return null;

  const content = optionalString(mainPrompt.content);
  if (!content) {
    throw new PromptPresetImportError(
      422,
      'empty_main_prompt',
      'OpenAI preset main prompt is empty.',
    );
  }

  return {
    candidate: {
      name:
        optionalString(input.name) ??
        optionalString(mainPrompt.name) ??
        fileNameToDisplayName(fileName) ??
        'Imported OpenAI Main Prompt',
      sourceType: 'st-openai-main',
      entries: [
        makeEntry({
          index: 0,
          identifier: optionalString(mainPrompt.identifier) ?? 'main',
          name: optionalString(mainPrompt.name) ?? 'Main Prompt',
          role: mainPrompt.role,
          enabled: mainPrompt.enabled !== false,
          content,
          marker: false,
        }),
      ],
      warnings: ['Imported OpenAI main prompt as one structured Prompt Preset entry. Other preset fields are ignored.'],
      ignoredFields: ignoredFields(input, ['name', 'prompts']),
      originalFileName: optionalString(fileName),
    },
    skippedCount: 0,
  };
}

function rejectKnownUnsupportedPreset(input: Record<string, unknown>): void {
  if (typeof input.input_sequence === 'string' || typeof input.output_sequence === 'string') {
    throw new PromptPresetImportError(
      422,
      'unsupported_preset',
      'Instruct templates are not supported by Prompt Presets import.',
    );
  }
  if (typeof input.story_string === 'string') {
    throw new PromptPresetImportError(
      422,
      'unsupported_preset',
      'Context templates are not supported by Prompt Presets import.',
    );
  }
  if (
    typeof input.prefix === 'string' &&
    typeof input.suffix === 'string' &&
    typeof input.separator === 'string'
  ) {
    throw new PromptPresetImportError(
      422,
      'unsupported_preset',
      'Reasoning templates are not supported by Prompt Presets import.',
    );
  }
  if (
    typeof input.temp === 'number' ||
    typeof input.top_k === 'number' ||
    typeof input.rep_pen === 'number'
  ) {
    throw new PromptPresetImportError(
      422,
      'unsupported_preset',
      'Sampling-only presets are not supported by Prompt Presets import.',
    );
  }
}

export function validatePromptPresetCandidate(candidate: unknown): PromptPresetCandidate {
  assertNoSensitiveContent(candidate);
  if (!isRecord(candidate)) {
    throw new PromptPresetImportError(
      400,
      'invalid_candidate',
      'Prompt preset candidate must be an object.',
    );
  }

  const sourceType = candidate.sourceType;
  const validSourceTypes: PromptPresetSourceType[] = [
    'roleagent',
    'st-sysprompt',
    'st-openai-main',
    'st-openai-prompt-list',
    'manual',
  ];
  if (!validSourceTypes.includes(sourceType as PromptPresetSourceType)) {
    throw new PromptPresetImportError(
      400,
      'invalid_candidate',
      'Prompt preset candidate has an unsupported source type.',
    );
  }

  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) {
    throw new PromptPresetImportError(
      400,
      'invalid_candidate',
      'Prompt preset candidate must include at least one entry.',
    );
  }

  const entries = candidate.entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new PromptPresetImportError(
        400,
        'invalid_candidate',
        'Prompt preset entries must be objects.',
      );
    }
    const content = typeof entry.content === 'string'
      ? entry.content.replaceAll('\0', '')
      : '';
    if (content.length > MAX_PRESET_ENTRY_CHARS) {
      throw new PromptPresetImportError(
        422,
        'prompt_preset_entry_too_long',
        'Prompt Preset entry content is too long.',
      );
    }
    return makeEntry({
      index,
      identifier: optionalString(entry.identifier),
      name: optionalString(entry.name),
      role: entry.role,
      enabled: entry.enabled !== false,
      content,
      marker: entry.marker === true,
      injectionPosition: optionalString(entry.injectionPosition),
      injectionDepth: optionalInteger(entry.injectionDepth),
      injectionOrder: optionalInteger(entry.injectionOrder),
    });
  });

  return {
    name: optionalString(candidate.name) ?? 'Imported Prompt Preset',
    sourceType: sourceType as PromptPresetSourceType,
    entries,
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.filter((item): item is string => typeof item === 'string')
      : [],
    ignoredFields: Array.isArray(candidate.ignoredFields)
      ? candidate.ignoredFields.filter((item): item is string => typeof item === 'string')
      : [],
    originalFileName: optionalString(candidate.originalFileName),
  };
}

export function previewPromptPresetImport(args: {
  json: unknown;
  fileName?: string;
}): PromptPresetImportPreviewResponse {
  assertImportSize(args.json);
  assertNoSensitiveContent(args.json);

  if (!isRecord(args.json)) {
    throw new PromptPresetImportError(
      400,
      'invalid_json',
      'Prompt preset import requires a JSON object.',
    );
  }

  const parsers = [
    parseRoleAgentPreset,
    parseSystemPromptPreset,
    parseOpenAiPromptListPreset,
    parseOpenAiMainPreset,
  ];
  for (const parser of parsers) {
    const result = parser(args.json, args.fileName);
    if (result) {
      const candidate = validatePromptPresetCandidate(result.candidate);
      return makePreview(candidate, result.skippedCount);
    }
  }

  rejectKnownUnsupportedPreset(args.json);

  throw new PromptPresetImportError(
    422,
    'unsupported_preset',
    'The JSON file is not a supported prompt preset format.',
  );
}

export function buildPromptPresetExport(args: {
  name: string;
  sourceType: PromptPresetSourceType;
  entries: PromptPresetEntryDto[];
}): PromptPresetExportResponse {
  return {
    format: 'roleagent-structured-prompt-preset',
    version: 1,
    name: args.name,
    sourceType: args.sourceType,
    entries: args.entries.map((entry) => ({
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      enabled: entry.enabled,
      content: entry.content,
      orderIndex: entry.orderIndex,
      marker: entry.marker,
      injectionPosition: entry.injectionPosition,
      injectionDepth: entry.injectionDepth,
      injectionOrder: entry.injectionOrder,
    })),
    exportedAt: new Date().toISOString(),
  };
}
