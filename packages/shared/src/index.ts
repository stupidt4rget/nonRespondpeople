export const appName = 'RoleAgent Tavern';

export interface HealthResponse {
  status: 'ok' | 'error';
  name: string;
}

export interface DbHealthResponse {
  status: 'ok' | 'error';
  database: string;
}

export interface CharacterDto {
  id: string;
  name: string;
  description: string | null;
  persona: string | null;
  personality: string | null;
  scenario: string | null;
  firstMessage: string | null;
  messageExample: string | null;
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
  rawCardJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  name: string;
  description?: string;
  persona?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  messageExample?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
}

export interface CharactersResponse {
  characters: CharacterDto[];
}

export interface UpdateCharacterRequest {
  name?: string;
  description?: string | null;
  persona?: string | null;
  personality?: string | null;
  scenario?: string | null;
  firstMessage?: string | null;
  messageExample?: string | null;
  systemPrompt?: string | null;
  postHistoryInstructions?: string | null;
}

export interface DeleteCharacterResponse {
  ok: true;
  id: string;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  characterId: string;
  message: string;
  history?: ChatHistoryMessage[];
}

export interface ChatResponse {
  reply: string;
  conversation?: ConversationDto;
  userMessage?: ChatMessageDto;
  assistantMessage?: ChatMessageDto;
  messages?: ChatMessageDto[];
  activeWorldBookIds?: string[];
}

export interface RegenerateChatResponse {
  reply: string;
  conversation: ConversationDto;
  assistantMessage: ChatMessageDto;
  messages: ChatMessageDto[];
  activeWorldBookIds: string[];
}

export interface ChatStreamDeltaEvent {
  type: 'delta';
  content: string;
}

export interface ChatStreamDoneEvent {
  type: 'done';
  reply: string;
  conversation: ConversationDto;
  userMessage?: ChatMessageDto;
  assistantMessage: ChatMessageDto;
  messages: ChatMessageDto[];
  activeWorldBookIds: string[];
}

export interface ChatStreamErrorEvent {
  type: 'error';
  error: string;
}

export type ChatStreamEvent =
  | ChatStreamDeltaEvent
  | ChatStreamDoneEvent
  | ChatStreamErrorEvent;

export interface LlmSettingsRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LlmSettingsStatusResponse {
  configured: boolean;
  source: 'memory' | 'env' | 'none';
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

export interface PromptSettingsDto {
  roleplayPreset: string;
  userPersona: string | null;
  authorsNote: string | null;
  userName: string;
  maxPromptChars: number;
  historyBudgetChars: number;
  worldBookBudgetChars: number;
  worldBookScanDepth: number;
}

export interface PromptSettingsRequest {
  roleplayPreset?: string;
  userPersona?: string | null;
  authorsNote?: string | null;
  userName?: string;
  maxPromptChars?: number;
  historyBudgetChars?: number;
  worldBookBudgetChars?: number;
  worldBookScanDepth?: number;
}

export interface GenerationSettingsDto {
  contextUnlockEnabled: boolean;
  contextLimitTokens: number;
  maxReplyTokens: number;
  responseCount: number;
  streamEnabled: boolean;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topP: number;
}

export interface GenerationSettingsRequest {
  contextUnlockEnabled?: boolean;
  contextLimitTokens?: number;
  maxReplyTokens?: number;
  responseCount?: number;
  streamEnabled?: boolean;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topP?: number;
}

export type PromptPresetSourceType =
  | 'roleagent'
  | 'st-sysprompt'
  | 'st-openai-main'
  | 'st-openai-prompt-list'
  | 'manual';

export type PromptPresetEntryRole = 'system' | 'user' | 'assistant';

export interface PromptPresetEntryDto {
  id: string;
  identifier: string | null;
  name: string;
  role: PromptPresetEntryRole;
  enabled: boolean;
  content: string;
  orderIndex: number;
  marker: boolean;
  injectionPosition: string | null;
  injectionDepth: number | null;
  injectionOrder: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptPresetDto {
  id: string;
  name: string;
  sourceType: PromptPresetSourceType;
  isActive: boolean;
  entryCount: number;
  importedAt: string | null;
  warnings: string[];
  ignoredFields: string[];
  originalFileName: string | null;
  createdAt: string;
  updatedAt: string;
  entries?: PromptPresetEntryDto[];
}

export interface PromptPresetListResponse {
  presets: PromptPresetDto[];
}

export interface PromptPresetDetailResponse {
  preset: PromptPresetDto;
}

export interface PromptPresetCandidate {
  name: string;
  sourceType: PromptPresetSourceType;
  entries: PromptPresetEntryDto[];
  warnings: string[];
  ignoredFields: string[];
  originalFileName: string | null;
}

export interface PromptPresetImportPreviewRequest {
  json: unknown;
  fileName?: string;
}

export interface PromptPresetImportPreviewResponse {
  candidate: PromptPresetCandidate;
  recognizedAs: PromptPresetSourceType;
  entriesPreview: PromptPresetEntryDto[];
  warnings: string[];
  ignoredFields: string[];
  willCreateEntryCount: number;
  willSkipCount: number;
}

export interface PromptPresetApplyRequest {
  candidate: PromptPresetCandidate;
}

export interface PromptPresetApplyResponse {
  preset: PromptPresetDto;
  warnings: string[];
}

export interface PromptPresetCreateRequest {
  name: string;
  entries?: Array<Partial<PromptPresetEntryDto>>;
}

export interface PromptPresetUpdateRequest {
  name?: string;
  isActive?: boolean;
}

export interface PromptPresetEntryUpdateRequest {
  entries: Array<Partial<PromptPresetEntryDto> & { id?: string }>;
}

export interface DeletePromptPresetResponse {
  ok: true;
  id: string;
}

export interface PromptPresetExportResponse {
  format: 'roleagent-structured-prompt-preset';
  version: 1;
  name: string;
  sourceType: PromptPresetSourceType;
  entries: Array<Omit<PromptPresetEntryDto, 'id' | 'createdAt' | 'updatedAt'>>;
  exportedAt: string;
}

export interface ImportCharacterCardRequest {
  name: string;
  description?: string;
  persona?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  messageExample?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  rawCardJson?: string;
  characterBook?: unknown;
}

export type ImportCharacterCardResponse = CharacterDto;

export interface ExportCharacterCardResponse {
  name: string;
  description?: string;
  persona?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  character_book?: unknown;
}

export interface WorldBookDto {
  id: string;
  name: string;
  description: string | null;
  entriesJson: string;
  rawJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldBooksResponse {
  worldBooks: WorldBookDto[];
}

export interface ImportWorldBookRequest {
  name?: string;
  description?: string;
  rawJson: unknown;
}

export interface DeleteWorldBookResponse {
  ok: true;
  id: string;
}

export interface CharacterWorldBooksResponse {
  characterId: string;
  worldBooks: WorldBookDto[];
  worldBookIds: string[];
}

export interface UpdateCharacterWorldBooksRequest {
  worldBookIds: string[];
}

export interface ConversationDto {
  id: string;
  characterId: string;
  title: string | null;
  activeWorldBookIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface CharacterConversationResponse {
  conversation: ConversationDto;
  messages: ChatMessageDto[];
  worldBooks: WorldBookDto[];
  activeWorldBookIds: string[];
}

export interface UpdateConversationWorldBooksRequest {
  worldBookIds: string[];
}

export interface UpdateChatMessageRequest {
  content: string;
}
