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
}

export type ImportCharacterCardResponse = CharacterDto;
