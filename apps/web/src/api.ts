import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  DeleteCharacterResponse,
  ChatRequest,
  ChatResponse,
  ImportCharacterCardRequest,
  LlmSettingsRequest,
  LlmSettingsStatusResponse,
  ExportCharacterCardResponse,
  WorldBookDto,
  WorldBooksResponse,
  ImportWorldBookRequest,
  DeleteWorldBookResponse,
  CharacterWorldBooksResponse,
  UpdateCharacterWorldBooksRequest,
  CharacterConversationResponse,
  UpdateConversationWorldBooksRequest,
} from '@roleagent/shared';

async function throwApiError(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  try {
    const err = (await res.json()) as { error?: unknown };
    if (typeof err.error === 'string') {
      message = err.error;
    }
  } catch {
    // Ignore non-JSON error responses and fall back to HTTP status.
  }
  throw new Error(message);
}

export async function fetchCharacters(): Promise<CharacterDto[]> {
  const res = await fetch('/api/characters');
  if (!res.ok) {
    return throwApiError(res);
  }
  const data = (await res.json()) as CharactersResponse;
  return data.characters;
}

export async function createCharacter(
  body: CreateCharacterRequest,
): Promise<CharacterDto> {
  const res = await fetch('/api/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterDto;
}

export async function importCharacterCard(
  body: ImportCharacterCardRequest,
): Promise<CharacterDto> {
  const res = await fetch('/api/characters/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterDto;
}

export async function fetchCharacter(id: string): Promise<CharacterDto> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterDto;
}

export async function updateCharacter(
  id: string,
  body: UpdateCharacterRequest,
): Promise<CharacterDto> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterDto;
}

export async function deleteCharacter(
  id: string,
): Promise<DeleteCharacterResponse> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as DeleteCharacterResponse;
}

export async function sendChat(body: ChatRequest): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as ChatResponse;
}

export async function getLlmSettings(): Promise<LlmSettingsStatusResponse> {
  const res = await fetch('/api/settings/llm');
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as LlmSettingsStatusResponse;
}

export async function saveLlmSettings(
  body: LlmSettingsRequest,
): Promise<LlmSettingsStatusResponse> {
  const res = await fetch('/api/settings/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as LlmSettingsStatusResponse;
}

export async function exportCharacterCard(
  id: string,
): Promise<ExportCharacterCardResponse> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}/export`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as ExportCharacterCardResponse;
}

export async function fetchWorldBooks(): Promise<WorldBookDto[]> {
  const res = await fetch('/api/worldbooks');
  if (!res.ok) {
    return throwApiError(res);
  }
  const data = (await res.json()) as WorldBooksResponse;
  return data.worldBooks;
}

export async function importWorldBook(
  body: ImportWorldBookRequest,
): Promise<WorldBookDto> {
  const res = await fetch('/api/worldbooks/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as WorldBookDto;
}

export async function exportWorldBook(id: string): Promise<unknown> {
  const res = await fetch(`/api/worldbooks/${encodeURIComponent(id)}/export`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as unknown;
}

export async function deleteWorldBook(
  id: string,
): Promise<DeleteWorldBookResponse> {
  const res = await fetch(`/api/worldbooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as DeleteWorldBookResponse;
}

export async function fetchCharacterWorldBooks(
  id: string,
): Promise<CharacterWorldBooksResponse> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}/worldbooks`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterWorldBooksResponse;
}

export async function updateCharacterWorldBooks(
  id: string,
  body: UpdateCharacterWorldBooksRequest,
): Promise<CharacterWorldBooksResponse> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}/worldbooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterWorldBooksResponse;
}

export async function getCharacterConversation(
  id: string,
): Promise<CharacterConversationResponse> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}/conversation`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}

export async function updateConversationWorldBooks(
  id: string,
  body: UpdateConversationWorldBooksRequest,
): Promise<CharacterConversationResponse> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/worldbooks`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}
