import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
} from '@roleagent/shared';

export async function fetchCharacters(): Promise<CharacterDto[]> {
  const res = await fetch('/api/characters');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
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
  return (await res.json()) as CharacterDto;
}
