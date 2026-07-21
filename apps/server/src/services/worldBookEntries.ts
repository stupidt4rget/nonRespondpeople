import type {
  WorldBookEntryDto,
  WorldBookInsertionPosition,
  WorldBookTriggerStrategy,
} from '@roleagent/shared';

const DEFAULT_INSERTION_POSITION: WorldBookInsertionPosition = 'afterCharacter';
const DEFAULT_TRIGGER_STRATEGY: WorldBookTriggerStrategy = 'keyword';
const DEFAULT_PROBABILITY = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function stringArrayFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[,\n\r，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
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

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = numberFromValue(value);
  if (parsed === null) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(min, rounded));
}

function boundedNullableInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = numberFromValue(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(min, rounded));
}

function insertionPositionFromValue(value: unknown): WorldBookInsertionPosition {
  if (
    value === 'beforeCharacter' ||
    value === 'afterCharacter' ||
    value === 'beforeRecentMessages' ||
    value === 'afterRecentMessages'
  ) {
    return value;
  }
  return DEFAULT_INSERTION_POSITION;
}

function triggerStrategyFromValue(value: unknown, constant: boolean): WorldBookTriggerStrategy {
  if (value === 'constant' || value === 'keyword' || value === 'selective') {
    return value;
  }
  return constant ? 'constant' : DEFAULT_TRIGGER_STRATEGY;
}

function contentFromEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!isRecord(entry)) return JSON.stringify(entry);
  const content = entry.content;
  return typeof content === 'string' ? content : JSON.stringify(entry);
}

function makeEntryId(index: number, entry: Record<string, unknown> | null): string {
  const id = entry ? trimText(entry.id) : null;
  return id ?? `entry-${index + 1}`;
}

export function normalizeWorldBookEntries(rawEntries: unknown): WorldBookEntryDto[] {
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries === null || rawEntries === undefined ? [] : [rawEntries];
  return entries
    .map((entry, index): WorldBookEntryDto | null => {
      const record = isRecord(entry) ? entry : null;
      const content = contentFromEntry(entry).trim();
      if (!content && !record) return null;
      const primaryKeys = record
        ? [
            ...stringArrayFromValue(record.primaryKeys),
            ...stringArrayFromValue(record.keys),
            ...stringArrayFromValue(record.key),
            ...stringArrayFromValue(record.keywords),
          ]
        : [];
      const secondaryKeys = record
        ? [
            ...stringArrayFromValue(record.secondaryKeys),
            ...stringArrayFromValue(record.secondary_keys),
            ...stringArrayFromValue(record.secondary),
          ]
        : [];
      const constant = record?.constant === true;
      const strategy = triggerStrategyFromValue(record?.triggerStrategy, constant);
      const comment = record ? trimText(record.comment) : null;
      const title = record
        ? (trimText(record.title) ?? trimText(record.name) ?? comment ?? `Entry ${index + 1}`)
        : `Entry ${index + 1}`;

      return {
        id: makeEntryId(index, record),
        enabled: record?.enabled === false || record?.disable === true ? false : true,
        title,
        comment,
        content,
        primaryKeys: [...new Set(primaryKeys)],
        secondaryKeys: [...new Set(secondaryKeys)],
        triggerStrategy: strategy,
        insertionPosition: insertionPositionFromValue(
          record?.insertionPosition ?? record?.insertion_position,
        ),
        order: boundedInteger(
          record?.order ?? record?.insertionOrder ?? record?.insertion_order,
          0,
          -100000,
          100000,
        ),
        depth: boundedNullableInteger(record?.depth, 0, 100),
        probability: boundedInteger(record?.probability, DEFAULT_PROBABILITY, 0, 100),
      };
    })
    .filter((entry): entry is WorldBookEntryDto => entry !== null);
}

export function parseWorldBookEntriesJson(entriesJson: string): WorldBookEntryDto[] {
  try {
    return normalizeWorldBookEntries(JSON.parse(entriesJson) as unknown);
  } catch {
    return [];
  }
}

export function serializeWorldBookEntries(
  entries: Array<Partial<WorldBookEntryDto>>,
): string {
  return JSON.stringify(normalizeWorldBookEntries(entries));
}

function assertOptionalString(
  entry: Record<string, unknown>,
  field: string,
  index: number,
): void {
  const value = entry[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`entries[${index}].${field} must be a string`);
  }
}

function assertOptionalFiniteNumber(
  entry: Record<string, unknown>,
  field: string,
  index: number,
  nullable = false,
): void {
  const value = entry[field];
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`entries[${index}].${field} must be a finite number`);
  }
}

export function validateWorldBookEntriesInput(
  entries: unknown,
): Array<Partial<WorldBookEntryDto>> {
  if (!Array.isArray(entries)) {
    throw new Error('entries must be an array');
  }

  entries.forEach((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`entries[${index}] must be an object`);
    }

    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
      throw new Error(`entries[${index}].enabled must be a boolean`);
    }
    assertOptionalString(value, 'id', index);
    assertOptionalString(value, 'title', index);
    if (
      value.comment !== undefined &&
      value.comment !== null &&
      typeof value.comment !== 'string'
    ) {
      throw new Error(`entries[${index}].comment must be a string or null`);
    }
    assertOptionalString(value, 'content', index);

    for (const field of ['primaryKeys', 'secondaryKeys'] as const) {
      const keys = value[field];
      if (
        keys !== undefined &&
        (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))
      ) {
        throw new Error(`entries[${index}].${field} must be an array of strings`);
      }
    }

    if (
      value.triggerStrategy !== undefined &&
      value.triggerStrategy !== 'constant' &&
      value.triggerStrategy !== 'keyword' &&
      value.triggerStrategy !== 'selective'
    ) {
      throw new Error(
        `entries[${index}].triggerStrategy must be constant, keyword, or selective`,
      );
    }

    if (
      value.insertionPosition !== undefined &&
      value.insertionPosition !== 'beforeCharacter' &&
      value.insertionPosition !== 'afterCharacter' &&
      value.insertionPosition !== 'beforeRecentMessages' &&
      value.insertionPosition !== 'afterRecentMessages'
    ) {
      throw new Error(
        `entries[${index}].insertionPosition must be a supported position`,
      );
    }

    assertOptionalFiniteNumber(value, 'order', index);
    assertOptionalFiniteNumber(value, 'depth', index, true);
    assertOptionalFiniteNumber(value, 'probability', index);
  });

  return entries as Array<Partial<WorldBookEntryDto>>;
}
