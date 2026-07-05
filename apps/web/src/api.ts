import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  DeleteCharacterResponse,
  ChatRequest,
  ChatResponse,
  ImportCharacterCardRequest,
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
