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
  scenario: string | null;
  firstMessage: string | null;
  messageExample: string | null;
  systemPrompt: string | null;
  rawCardJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  name: string;
  description?: string;
  persona?: string;
  scenario?: string;
  firstMessage?: string;
  messageExample?: string;
  systemPrompt?: string;
}

export interface CharactersResponse {
  characters: CharacterDto[];
}

export interface UpdateCharacterRequest {
  name?: string;
  description?: string | null;
  persona?: string | null;
  scenario?: string | null;
  firstMessage?: string | null;
  messageExample?: string | null;
  systemPrompt?: string | null;
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

export interface ImportCharacterCardRequest {
  name: string;
  description?: string;
  persona?: string;
  scenario?: string;
  firstMessage?: string;
  messageExample?: string;
  systemPrompt?: string;
  rawCardJson?: string;
  characterBook?: unknown;
}

export type ImportCharacterCardResponse = CharacterDto;

export interface ExportCharacterCardResponse {
  name: string;
  description?: string;
  persona?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
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
