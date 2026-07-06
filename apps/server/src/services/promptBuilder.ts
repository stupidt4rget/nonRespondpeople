import type { PromptSettingsDto } from '@roleagent/shared';

export type PromptRole = 'system' | 'user' | 'assistant';

export interface PromptMessage {
  role: PromptRole;
  content: string;
}

export interface PromptCharacter {
  name: string;
  description: string | null;
  persona: string | null;
  personality: string | null;
  scenario: string | null;
  firstMessage: string | null;
  messageExample: string | null;
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
}

export interface PromptWorldBook {
  name: string;
  description: string | null;
  entriesJson: string;
}

export interface PromptBuilderInput {
  character: PromptCharacter;
  worldBooks: PromptWorldBook[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  promptSettings?: PromptSettingsDto;
  userName?: string;
  limits?: {
    maxPromptChars?: number;
    historyBudgetChars?: number;
    worldBookMaxChars?: number;
    examplesMaxChars?: number;
    worldBookScanDepth?: number;
  };
}

export interface PromptDebugInfo {
  characterSections: string[];
  activatedWorldBookEntries: number;
  droppedHistoryMessages: number;
  totalChars: number;
  messageOutline: Array<{
    index: number;
    role: PromptRole;
    length: number;
    preview: string;
  }>;
}

export interface PromptBuilderOutput {
  messages: PromptMessage[];
  debug: PromptDebugInfo;
}

interface MacroValues {
  char: string;
  user: string;
  persona: string;
  description: string;
  personality: string;
  scenario: string;
}

interface ParsedWorldBookEntry {
  worldBookName: string;
  label: string | null;
  content: string;
  keys: string[];
  constant: boolean;
  order: number;
  sourceIndex: number;
}

const DEFAULT_MAX_PROMPT_CHARS = 24000;
const DEFAULT_HISTORY_BUDGET_CHARS = 12000;
const DEFAULT_WORLDBOOK_MAX_CHARS = 6000;
const DEFAULT_EXAMPLES_MAX_CHARS = 4000;
const DEFAULT_WORLDBOOK_SCAN_DEPTH = 3;
const BASE_INSTRUCTION_TEMPLATE = [
  'You are roleplaying as {{char}}.',
  'You are only {{char}}.',
  'Never speak, act, think, or decide for {{user}}.',
  'Do not merge {{char}} with {{user}}.',
  'Reply only as {{char}} unless the character card explicitly says otherwise.',
  'Stay in character and continue the scene naturally.',
].join('\n');
const ROLE_BOUNDARY_REMINDER_TEMPLATE =
  "Remember: reply only as {{char}}. Do not write {{user}}'s words, thoughts, or actions.";
const DEFAULT_PROMPT_SETTINGS: PromptSettingsDto = {
  roleplayPreset: BASE_INSTRUCTION_TEMPLATE,
  userPersona: null,
  authorsNote: null,
  userName: 'User',
  maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  historyBudgetChars: DEFAULT_HISTORY_BUDGET_CHARS,
  worldBookBudgetChars: DEFAULT_WORLDBOOK_MAX_CHARS,
  worldBookScanDepth: DEFAULT_WORLDBOOK_SCAN_DEPTH,
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function countMessageChars(messages: PromptMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function buildMessageOutline(messages: PromptMessage[]): PromptDebugInfo['messageOutline'] {
  return messages.map((message, index) => ({
    index,
    role: message.role,
    length: message.content.length,
    preview: message.content.replace(/\s+/g, ' ').trim().slice(0, 80),
  }));
}

function buildMacroValues(
  character: PromptCharacter,
  userName: string,
  userPersona: string,
): MacroValues {
  const personality =
    normalizeOptionalText(character.personality) ??
    normalizeOptionalText(character.persona) ??
    '';
  return {
    char: character.name,
    user: userName,
    persona: userPersona,
    description: normalizeOptionalText(character.description) ?? '',
    personality,
    scenario: normalizeOptionalText(character.scenario) ?? '',
  };
}

export function substituteMacros(
  value: string,
  character: PromptCharacter,
  userName = 'User',
  userPersona = '',
): string {
  const now = new Date();
  const macros = buildMacroValues(character, userName, userPersona);
  return value
    .replaceAll('{{char}}', macros.char)
    .replaceAll('{{user}}', macros.user)
    .replaceAll('{{persona}}', macros.persona)
    .replaceAll('{{description}}', macros.description)
    .replaceAll('{{personality}}', macros.personality)
    .replaceAll('{{scenario}}', macros.scenario)
    .replaceAll('{{date}}', now.toLocaleDateString())
    .replaceAll('{{time}}', now.toLocaleTimeString());
}

function systemMessage(
  content: string | null,
  character: PromptCharacter,
  userName: string,
  userPersona: string,
): PromptMessage | null {
  if (!content) return null;
  const rendered = substituteMacros(
    content,
    character,
    userName,
    userPersona,
  ).trim();
  return rendered.length > 0 ? { role: 'system', content: rendered } : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArrayFromValue(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function entryContent(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!isRecord(entry)) return JSON.stringify(entry);
  const content = entry.content;
  if (typeof content === 'string') return content;
  return JSON.stringify(entry);
}

function entryLabel(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const comment = entry.comment;
  const name = entry.name;
  if (typeof comment === 'string' && comment.trim() !== '') return comment.trim();
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  return null;
}

function entryKeys(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  return [
    ...stringArrayFromValue(entry.keys),
    ...stringArrayFromValue(entry.key),
    ...stringArrayFromValue(entry.keywords),
  ];
}

function entryConstant(entry: unknown): boolean {
  return isRecord(entry) && entry.constant === true;
}

function entryOrder(entry: unknown): number {
  if (!isRecord(entry)) return 0;
  return (
    numberFromValue(entry.insertion_order) ??
    numberFromValue(entry.insertionOrder) ??
    numberFromValue(entry.order) ??
    0
  );
}

function parseWorldBookEntries(worldBooks: PromptWorldBook[]): ParsedWorldBookEntry[] {
  const parsed: ParsedWorldBookEntry[] = [];
  let sourceIndex = 0;
  for (const worldBook of worldBooks) {
    const raw = parseJson(worldBook.entriesJson);
    const entries = Array.isArray(raw) ? raw : [raw];
    for (const entry of entries) {
      const content = normalizeOptionalText(entryContent(entry));
      if (!content) continue;
      parsed.push({
        worldBookName: worldBook.name,
        label: entryLabel(entry),
        content,
        keys: entryKeys(entry),
        constant: entryConstant(entry),
        order: entryOrder(entry),
        sourceIndex,
      });
      sourceIndex += 1;
    }
  }
  return parsed;
}

function buildWorldBookBlock(args: {
  character: PromptCharacter;
  userName: string;
  userPersona: string;
  worldBooks: PromptWorldBook[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  maxChars: number;
  scanDepth: number;
}): { message: PromptMessage | null; activatedCount: number } {
  const scanDepth = Math.max(0, args.scanDepth);
  const recentHistory = scanDepth > 0 ? args.history.slice(-scanDepth) : [];
  const scanText = [
    ...recentHistory.map((message) => message.content),
    args.userMessage,
  ].join('\n').toLowerCase();

  const activated = parseWorldBookEntries(args.worldBooks)
    .filter((entry) => {
      if (entry.constant) return true;
      return entry.keys.some((key) => scanText.includes(key.toLowerCase()));
    })
    .sort((a, b) => {
      if (b.order !== a.order) return b.order - a.order;
      return a.sourceIndex - b.sourceIndex;
    });

  const chunks: string[] = [];
  let total = 0;
  for (const entry of activated) {
    const title = entry.label
      ? `Worldbook: ${entry.worldBookName} / ${entry.label}`
      : `Worldbook: ${entry.worldBookName}`;
    const rendered = substituteMacros(
      entry.content,
      args.character,
      args.userName,
      args.userPersona,
    );
    const chunk = `${title}\n${rendered}`;
    if (total + chunk.length > args.maxChars) {
      if (chunks.length === 0) {
        chunks.push(clipText(chunk, args.maxChars));
      }
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }

  if (chunks.length === 0) {
    return { message: null, activatedCount: activated.length };
  }

  return {
    message: {
      role: 'system',
      content: `Relevant worldbook entries:\n\n${chunks.join('\n\n---\n\n')}`,
    },
    activatedCount: activated.length,
  };
}

function normalizeSpeakerName(value: string): string {
  return value.trim().toLowerCase();
}

function lineSpeakerRole(
  speaker: string,
  character: PromptCharacter,
  userName: string,
): PromptRole | null {
  const normalized = normalizeSpeakerName(speaker);
  const userNames = new Set([
    normalizeSpeakerName('{{user}}'),
    normalizeSpeakerName('User'),
    normalizeSpeakerName(userName),
  ]);
  const characterNames = new Set([
    normalizeSpeakerName('{{char}}'),
    normalizeSpeakerName(character.name),
  ]);

  if (userNames.has(normalized)) return 'user';
  if (characterNames.has(normalized)) return 'assistant';
  return null;
}

function parseExampleBlock(
  block: string,
  character: PromptCharacter,
  userName: string,
  userPersona: string,
): PromptMessage[] {
  const messages: PromptMessage[] = [];
  const lines = block.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([^:\uFF1A]{1,80})\s*[:\uFF1A]\s*(.*)$/);
    if (match) {
      const role = lineSpeakerRole(match[1] ?? '', character, userName);
      if (role === 'user' || role === 'assistant') {
        const content = substituteMacros(
          match[2] ?? '',
          character,
          userName,
          userPersona,
        ).trim();
        if (content !== '') {
          messages.push({ role, content });
        }
        continue;
      }
    }

    const rendered = substituteMacros(
      line,
      character,
      userName,
      userPersona,
    ).trim();
    if (rendered === '') continue;
    const last = messages.at(-1);
    if (last) {
      last.content = `${last.content}\n${rendered}`;
    }
  }

  return messages;
}

function hasMeaningfulFallbackExample(value: string): boolean {
  const compact = value.replace(/[\s[\],]+/g, '');
  return compact.length >= 2;
}

function buildExampleMessages(
  character: PromptCharacter,
  userName: string,
  userPersona: string,
  maxChars: number,
): PromptMessage[] {
  const raw = normalizeOptionalText(character.messageExample);
  if (!raw) return [];

  const blocks = raw
    .split(/<START>/i)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return [];

  const messages: PromptMessage[] = [
    {
      role: 'system',
      content: 'Example dialogue follows. Use it only as style guidance.',
    },
  ];
  let total = 0;
  for (const block of blocks) {
    const parsed = parseExampleBlock(block, character, userName, userPersona);
    const fallbackContent = substituteMacros(
      block,
      character,
      userName,
      userPersona,
    ).trim();
    const blockMessages =
      parsed.length > 0
        ? parsed
        : hasMeaningfulFallbackExample(fallbackContent)
          ? [
              {
                role: 'system' as const,
                content: `[Example Chat]\n${fallbackContent}`,
              },
            ]
          : [];

    for (const message of blockMessages) {
      if (total + message.content.length > maxChars) {
        if (messages.length === 1) {
          messages.push({
            role: message.role,
            content: clipText(message.content, maxChars),
          });
        }
        return messages.length > 1 ? messages : [];
      }
      messages.push(message);
      total += message.content.length;
    }
  }

  return messages.length > 1 ? messages : [];
}

function trimHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  remainingChars: number,
  character: PromptCharacter,
  userName: string,
  userPersona: string,
): { messages: PromptMessage[]; dropped: number } {
  const selected: PromptMessage[] = [];
  let used = 0;
  let dropped = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const content = substituteMacros(
      message.content,
      character,
      userName,
      userPersona,
    );
    const cost = content.length;
    if (used + cost > remainingChars) {
      dropped += 1;
      continue;
    }
    selected.push({ role: message.role, content });
    used += cost;
  }

  return { messages: selected.reverse(), dropped };
}

export function buildPromptMessages(input: PromptBuilderInput): PromptBuilderOutput {
  const promptSettings = input.promptSettings ?? DEFAULT_PROMPT_SETTINGS;
  const userName = input.userName ?? promptSettings.userName ?? 'User';
  const userPersona = normalizeOptionalText(promptSettings.userPersona) ?? '';
  const limits = {
    maxPromptChars:
      input.limits?.maxPromptChars ??
      promptSettings.maxPromptChars ??
      DEFAULT_MAX_PROMPT_CHARS,
    historyBudgetChars:
      input.limits?.historyBudgetChars ??
      promptSettings.historyBudgetChars ??
      DEFAULT_HISTORY_BUDGET_CHARS,
    worldBookMaxChars:
      input.limits?.worldBookMaxChars ??
      promptSettings.worldBookBudgetChars ??
      DEFAULT_WORLDBOOK_MAX_CHARS,
    examplesMaxChars: input.limits?.examplesMaxChars ?? DEFAULT_EXAMPLES_MAX_CHARS,
    worldBookScanDepth:
      input.limits?.worldBookScanDepth ??
      promptSettings.worldBookScanDepth ??
      DEFAULT_WORLDBOOK_SCAN_DEPTH,
  };

  const characterSections: string[] = ['base'];
  const personality =
    normalizeOptionalText(input.character.personality) ??
    normalizeOptionalText(input.character.persona);
  const baseTemplate =
    normalizeOptionalText(promptSettings.roleplayPreset) ?? BASE_INSTRUCTION_TEMPLATE;
  const baseInstruction = substituteMacros(
    baseTemplate,
    input.character,
    userName,
    userPersona,
  );
  const fixedMessages: PromptMessage[] = [
    {
      role: 'system',
      content: baseInstruction,
    },
  ];

  const personaMessage = systemMessage(
    userPersona ? `User persona:\n${userPersona}` : null,
    input.character,
    userName,
    userPersona,
  );
  if (personaMessage) {
    fixedMessages.push(personaMessage);
    characterSections.push('userPersona');
  }

  const rawSystemPrompt = normalizeOptionalText(input.character.systemPrompt);
  const systemPrompt = systemMessage(
    rawSystemPrompt?.replaceAll('{{original}}', baseInstruction) ?? null,
    input.character,
    userName,
    userPersona,
  );
  if (systemPrompt) {
    fixedMessages.push(systemPrompt);
    characterSections.push('systemPrompt');
  }

  const description = systemMessage(
    normalizeOptionalText(input.character.description),
    input.character,
    userName,
    userPersona,
  );
  if (description) {
    fixedMessages.push(description);
    characterSections.push('description');
  }

  const personalityMessage = systemMessage(
    personality,
    input.character,
    userName,
    userPersona,
  );
  if (personalityMessage) {
    fixedMessages.push(personalityMessage);
    characterSections.push(
      normalizeOptionalText(input.character.personality) ? 'personality' : 'persona',
    );
  }

  const scenario = systemMessage(
    normalizeOptionalText(input.character.scenario),
    input.character,
    userName,
    userPersona,
  );
  if (scenario) {
    fixedMessages.push(scenario);
    characterSections.push('scenario');
  }

  const worldBook = buildWorldBookBlock({
    character: input.character,
    userName,
    userPersona,
    worldBooks: input.worldBooks,
    history: input.history,
    userMessage: input.userMessage,
    maxChars: limits.worldBookMaxChars,
    scanDepth: limits.worldBookScanDepth,
  });
  if (worldBook.message) fixedMessages.push(worldBook.message);

  const examples = buildExampleMessages(
    input.character,
    userName,
    userPersona,
    limits.examplesMaxChars,
  );
  fixedMessages.push(...examples);

  const currentUserMessage: PromptMessage = {
    role: 'user',
    content: substituteMacros(
      input.userMessage,
      input.character,
      userName,
      userPersona,
    ),
  };
  const authorsNote = systemMessage(
    normalizeOptionalText(promptSettings.authorsNote)
      ? `Author's Note:\n${promptSettings.authorsNote}`
      : null,
    input.character,
    userName,
    userPersona,
  );
  const postHistory = systemMessage(
    normalizeOptionalText(input.character.postHistoryInstructions),
    input.character,
    userName,
    userPersona,
  );
  const roleBoundaryReminder: PromptMessage = {
    role: 'system',
    content: substituteMacros(
      ROLE_BOUNDARY_REMINDER_TEMPLATE,
      input.character,
      userName,
      userPersona,
    ),
  };

  const fixedCost =
    countMessageChars(fixedMessages) +
    currentUserMessage.content.length +
    (authorsNote?.content.length ?? 0) +
    (postHistory?.content.length ?? 0) +
    roleBoundaryReminder.content.length;
  const remainingForHistory = Math.max(
    0,
    Math.min(limits.historyBudgetChars, limits.maxPromptChars - fixedCost),
  );
  const trimmedHistory = trimHistory(
    input.history,
    remainingForHistory,
    input.character,
    userName,
    userPersona,
  );

  const messages = [
    ...fixedMessages,
    ...trimmedHistory.messages,
    ...(authorsNote ? [authorsNote] : []),
    ...(postHistory ? [postHistory] : []),
    roleBoundaryReminder,
    currentUserMessage,
  ];

  return {
    messages,
    debug: {
      characterSections,
      activatedWorldBookEntries: worldBook.activatedCount,
      droppedHistoryMessages: trimmedHistory.dropped,
      totalChars: countMessageChars(messages),
      messageOutline: buildMessageOutline(messages),
    },
  };
}
