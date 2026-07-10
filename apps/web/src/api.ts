import type {
  CharacterDto,
  CharactersResponse,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  DeleteCharacterResponse,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  RegenerateChatResponse,
  ImportCharacterCardRequest,
  GenerationSettingsDto,
  GenerationSettingsRequest,
  LlmSettingsRequest,
  LlmSettingsStatusResponse,
  DeletePromptPresetResponse,
  PromptPresetApplyRequest,
  PromptPresetApplyResponse,
  PromptPresetCreateRequest,
  PromptPresetDetailResponse,
  PromptPresetDto,
  PromptPresetEntryUpdateRequest,
  PromptPresetExportResponse,
  PromptPresetImportPreviewRequest,
  PromptPresetImportPreviewResponse,
  PromptPresetListResponse,
  PromptPresetUpdateRequest,
  PromptSettingsDto,
  PromptSettingsRequest,
  ExportCharacterCardResponse,
  WorldBookDto,
  WorldBooksResponse,
  ImportWorldBookRequest,
  CreateCharacterWorldBookRequest,
  CreateWorldBookRequest,
  UpdateWorldBookRequest,
  DeleteWorldBookResponse,
  CharacterWorldBooksResponse,
  UpdateCharacterWorldBooksRequest,
  CharacterConversationResponse,
  UpdateChatMessageRequest,
  UpdateConversationWorldBooksRequest,
  SelectMessageVariantResponse,
  UserPersonaDto,
  UserPersonasResponse,
  CreateUserPersonaRequest,
  UpdateUserPersonaRequest,
  DeleteUserPersonaResponse,
  UpdateConversationUserPersonaRequest,
} from '@roleagent/shared';

async function throwApiError(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  try {
    const err = (await res.json()) as { error?: unknown };
    if (typeof err.error === 'string') {
      message = err.error;
      if (err.error === 'payload_too_large') {
        message = 'Preset file is too large. Maximum supported size is 10 MB.';
      }
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
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as LlmSettingsStatusResponse;
}

export async function selectMessageVariant(
  conversationId: string,
  messageId: string,
  variantId: string,
): Promise<SelectMessageVariantResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/variants/${encodeURIComponent(variantId)}/select`,
    { method: 'PATCH' },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as SelectMessageVariantResponse;
}

export async function getPromptSettings(): Promise<PromptSettingsDto> {
  const res = await fetch('/api/settings/prompt');
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptSettingsDto;
}

export async function updatePromptSettings(
  body: PromptSettingsRequest,
): Promise<PromptSettingsDto> {
  const res = await fetch('/api/settings/prompt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptSettingsDto;
}

export async function resetPromptSettings(): Promise<PromptSettingsDto> {
  const res = await fetch('/api/settings/prompt/reset', {
    method: 'POST',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptSettingsDto;
}

export async function getGenerationSettings(): Promise<GenerationSettingsDto> {
  const res = await fetch('/api/settings/generation');
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as GenerationSettingsDto;
}

export async function updateGenerationSettings(
  body: GenerationSettingsRequest,
): Promise<GenerationSettingsDto> {
  const res = await fetch('/api/settings/generation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as GenerationSettingsDto;
}

export async function resetGenerationSettings(): Promise<GenerationSettingsDto> {
  const res = await fetch('/api/settings/generation/reset', {
    method: 'POST',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as GenerationSettingsDto;
}

export async function previewPromptPresetImport(
  body: PromptPresetImportPreviewRequest,
): Promise<PromptPresetImportPreviewResponse> {
  const res = await fetch('/api/prompt-presets/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetImportPreviewResponse;
}

export async function applyPromptPresetImport(
  body: PromptPresetApplyRequest,
): Promise<PromptPresetApplyResponse> {
  const res = await fetch('/api/prompt-presets/import/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetApplyResponse;
}

export async function fetchPromptPresets(): Promise<PromptPresetDto[]> {
  const res = await fetch('/api/prompt-presets');
  if (!res.ok) {
    return throwApiError(res);
  }
  const data = (await res.json()) as PromptPresetListResponse;
  return data.presets;
}

export async function fetchPromptPreset(id: string): Promise<PromptPresetDto> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}`);
  if (!res.ok) {
    return throwApiError(res);
  }
  const data = (await res.json()) as PromptPresetDetailResponse;
  return data.preset;
}

export async function createPromptPreset(
  body: PromptPresetCreateRequest,
): Promise<PromptPresetDto> {
  const res = await fetch('/api/prompt-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetDto;
}

export async function updatePromptPreset(
  id: string,
  body: PromptPresetUpdateRequest,
): Promise<PromptPresetDto> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetDto;
}

export async function activatePromptPreset(id: string): Promise<PromptPresetDto> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetDto;
}

export async function updatePromptPresetEntries(
  id: string,
  body: PromptPresetEntryUpdateRequest,
): Promise<PromptPresetDto> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}/entries`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetDto;
}

export async function deletePromptPreset(
  id: string,
): Promise<DeletePromptPresetResponse> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as DeletePromptPresetResponse;
}

export async function duplicatePromptPreset(id: string): Promise<PromptPresetDto> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetDto;
}

export async function exportPromptPreset(id: string): Promise<PromptPresetExportResponse> {
  const res = await fetch(`/api/prompt-presets/${encodeURIComponent(id)}/export`);
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as PromptPresetExportResponse;
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

export async function createWorldBook(
  body: CreateWorldBookRequest,
): Promise<WorldBookDto> {
  const res = await fetch('/api/worldbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as WorldBookDto;
}

export async function updateWorldBook(
  id: string,
  body: UpdateWorldBookRequest,
): Promise<WorldBookDto> {
  const res = await fetch(`/api/worldbooks/${encodeURIComponent(id)}`, {
    method: 'PUT',
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

export async function createCharacterWorldBook(
  id: string,
  body: CreateCharacterWorldBookRequest = {},
): Promise<WorldBookDto> {
  const res = await fetch(`/api/characters/${encodeURIComponent(id)}/worldbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as WorldBookDto;
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

export async function fetchUserPersonas(): Promise<UserPersonaDto[]> {
  const res = await fetch('/api/user-personas');
  if (!res.ok) {
    return throwApiError(res);
  }
  const data = (await res.json()) as UserPersonasResponse;
  return data.personas;
}

export async function createUserPersona(
  body: CreateUserPersonaRequest,
): Promise<UserPersonaDto> {
  const res = await fetch('/api/user-personas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as UserPersonaDto;
}

export async function updateUserPersona(
  id: string,
  body: UpdateUserPersonaRequest,
): Promise<UserPersonaDto> {
  const res = await fetch(`/api/user-personas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as UserPersonaDto;
}

export async function deleteUserPersona(
  id: string,
): Promise<DeleteUserPersonaResponse> {
  const res = await fetch(`/api/user-personas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as DeleteUserPersonaResponse;
}

export async function updateConversationUserPersona(
  conversationId: string,
  body: UpdateConversationUserPersonaRequest,
): Promise<CharacterConversationResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/user-persona`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}

export async function updateChatMessage(
  conversationId: string,
  messageId: string,
  body: UpdateChatMessageRequest,
): Promise<CharacterConversationResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}

export async function deleteChatMessage(
  conversationId: string,
  messageId: string,
): Promise<CharacterConversationResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}

export async function clearConversationMessages(
  conversationId: string,
): Promise<CharacterConversationResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as CharacterConversationResponse;
}

export async function regenerateLastAssistant(
  conversationId: string,
): Promise<RegenerateChatResponse> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/regenerate`,
    { method: 'POST' },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return (await res.json()) as RegenerateChatResponse;
}

interface StreamRequestOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

async function readNdjsonStream(
  res: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  if (!res.body) {
    throw new Error('stream response body is not available');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as ChatStreamEvent;
    if (event.type === 'error') {
      throw new Error(event.error);
    }
    onEvent(event);
  };

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        parseLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    parseLine(buffer);
  } finally {
    reader.releaseLock();
  }
}

export async function streamChat(
  body: ChatRequest,
  options: StreamRequestOptions,
): Promise<void> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return readNdjsonStream(res, options.onEvent);
}

export async function streamRegenerate(
  conversationId: string,
  options: StreamRequestOptions,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/regenerate/stream`,
    {
      method: 'POST',
      signal: options.signal,
    },
  );
  if (!res.ok) {
    return throwApiError(res);
  }
  return readNdjsonStream(res, options.onEvent);
}
