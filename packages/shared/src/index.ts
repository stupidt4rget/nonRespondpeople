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
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  name: string;
  description?: string;
}

export interface CharactersResponse {
  characters: CharacterDto[];
}

export interface UpdateCharacterRequest {
  name?: string;
  description?: string | null;
}

export interface DeleteCharacterResponse {
  ok: true;
  id: string;
}

export interface ChatRequest {
  characterId: string;
  message: string;
}

export interface ChatResponse {
  reply: string;
}
