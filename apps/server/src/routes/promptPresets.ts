import type { FastifyInstance } from 'fastify';
import type {
  DeletePromptPresetResponse,
  PromptPresetApplyRequest,
  PromptPresetCandidate,
  PromptPresetCreateRequest,
  PromptPresetDetailResponse,
  PromptPresetDto,
  PromptPresetEntryDto,
  PromptPresetEntryRole,
  PromptPresetEntryUpdateRequest,
  PromptPresetImportPreviewRequest,
  PromptPresetListResponse,
  PromptPresetSourceType,
  PromptPresetUpdateRequest,
} from '@roleagent/shared';
import { prisma } from '../db/prisma.js';
import {
  buildPromptPresetExport,
  previewPromptPresetImport,
  PromptPresetImportError,
  validatePromptPresetCandidate,
} from '../services/promptPresetImport.js';

type DbPromptPreset = {
  id: string;
  name: string;
  sourceType: string;
  isActive: boolean;
  importedAt: Date | null;
  warningsJson: string | null;
  ignoredFieldsJson: string | null;
  originalFileName: string | null;
  createdAt: Date;
  updatedAt: Date;
  entries?: DbPromptPresetEntry[];
  _count?: { entries: number };
};

type DbPromptPresetEntry = {
  id: string;
  identifier: string | null;
  name: string;
  role: string;
  enabled: boolean;
  content: string;
  orderIndex: number;
  marker: boolean;
  injectionPosition: string | null;
  injectionDepth: number | null;
  injectionOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalizeRole(value: unknown): PromptPresetEntryRole {
  return value === 'user' || value === 'assistant' ? value : 'system';
}

function normalizeEntryInput(
  entry: Partial<PromptPresetEntryDto>,
  index: number,
): Omit<PromptPresetEntryDto, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    identifier: optionalString(entry.identifier),
    name: optionalString(entry.name) ?? `Prompt ${index + 1}`,
    role: normalizeRole(entry.role),
    enabled: entry.enabled !== false,
    content: typeof entry.content === 'string' ? entry.content.replaceAll('\0', '') : '',
    orderIndex: Number.isFinite(entry.orderIndex) ? Number(entry.orderIndex) : index,
    marker: entry.marker === true,
    injectionPosition: optionalString(entry.injectionPosition),
    injectionDepth:
      typeof entry.injectionDepth === 'number' && Number.isFinite(entry.injectionDepth)
        ? Math.round(entry.injectionDepth)
        : null,
    injectionOrder:
      typeof entry.injectionOrder === 'number' && Number.isFinite(entry.injectionOrder)
        ? Math.round(entry.injectionOrder)
        : null,
  };
}

function toEntryDto(entry: DbPromptPresetEntry): PromptPresetEntryDto {
  return {
    id: entry.id,
    identifier: entry.identifier,
    name: entry.name,
    role: normalizeRole(entry.role),
    enabled: entry.enabled,
    content: entry.content,
    orderIndex: entry.orderIndex,
    marker: entry.marker,
    injectionPosition: entry.injectionPosition,
    injectionDepth: entry.injectionDepth,
    injectionOrder: entry.injectionOrder,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function toPresetDto(preset: DbPromptPreset): PromptPresetDto {
  const entries = preset.entries?.map(toEntryDto).sort((a, b) => a.orderIndex - b.orderIndex);
  return {
    id: preset.id,
    name: preset.name,
    sourceType: preset.sourceType as PromptPresetSourceType,
    isActive: preset.isActive,
    entryCount: entries?.length ?? preset._count?.entries ?? 0,
    importedAt: preset.importedAt?.toISOString() ?? null,
    warnings: parseStringArray(preset.warningsJson),
    ignoredFields: parseStringArray(preset.ignoredFieldsJson),
    originalFileName: preset.originalFileName,
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
    ...(entries ? { entries } : {}),
  };
}

async function createPresetFromCandidate(
  candidate: PromptPresetCandidate,
): Promise<PromptPresetDto> {
  const valid = validatePromptPresetCandidate(candidate);
  const created = await prisma.promptPreset.create({
    data: {
      name: valid.name,
      sourceType: valid.sourceType,
      isActive: false,
      importedAt: new Date(),
      warningsJson: JSON.stringify(valid.warnings),
      ignoredFieldsJson: JSON.stringify(valid.ignoredFields),
      originalFileName: valid.originalFileName,
      entries: {
        create: valid.entries.map((entry, index) => ({
          identifier: entry.identifier,
          name: entry.name,
          role: entry.role,
          enabled: entry.enabled,
          content: entry.content,
          orderIndex: index,
          marker: entry.marker,
          injectionPosition: entry.injectionPosition,
          injectionDepth: entry.injectionDepth,
          injectionOrder: entry.injectionOrder,
        })),
      },
    },
    include: { entries: { orderBy: { orderIndex: 'asc' } } },
  });
  return toPresetDto(created as DbPromptPreset);
}

export async function getActivePromptPresetEntries(): Promise<PromptPresetEntryDto[]> {
  const active = await prisma.promptPreset.findFirst({
    where: { isActive: true },
    include: { entries: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  if (!active) return [];
  return (active.entries as DbPromptPresetEntry[]).map(toEntryDto);
}

export async function promptPresetRoutes(app: FastifyInstance) {
  app.get('/api/prompt-presets', async () => {
    const presets = await prisma.promptPreset.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
    const body: PromptPresetListResponse = {
      presets: (presets as DbPromptPreset[]).map(toPresetDto),
    };
    return body;
  });

  app.post('/api/prompt-presets', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as unknown as PromptPresetCreateRequest;
    const name = optionalString(body.name);
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const rawEntries: Array<Partial<PromptPresetEntryDto>> = Array.isArray(body.entries) && body.entries.length > 0
      ? body.entries
      : [{ name: 'System Prompt', role: 'system', enabled: true, content: '' }];
    const entries = rawEntries.map(normalizeEntryInput);
    const created = await prisma.promptPreset.create({
      data: {
        name,
        sourceType: 'manual',
        isActive: false,
        entries: {
          create: entries.map((entry, index) => ({
            ...entry,
            orderIndex: index,
          })),
        },
      },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    return reply.code(201).send(toPresetDto(created as DbPromptPreset));
  });

  app.post(
    '/api/prompt-presets/import/preview',
    { bodyLimit: 12 * 1024 * 1024 },
    async (req, reply) => {
      if (!isPlainObject(req.body)) {
        return reply.code(400).send({ error: 'request body must be an object' });
      }

      try {
        const { json, fileName } = req.body as unknown as PromptPresetImportPreviewRequest;
        return previewPromptPresetImport({ json, fileName });
      } catch (err) {
        if (err instanceof PromptPresetImportError) {
          return reply
            .code(err.statusCode)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post('/api/prompt-presets/import/apply', async (req, reply) => {
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }

    try {
      const { candidate } = req.body as unknown as PromptPresetApplyRequest;
      const preset = await createPresetFromCandidate(candidate);
      return reply.code(201).send({ preset, warnings: preset.warnings });
    } catch (err) {
      if (err instanceof PromptPresetImportError) {
        return reply
          .code(err.statusCode)
          .send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/prompt-presets/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!found) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    const dto = toPresetDto(found as DbPromptPreset);
    return buildPromptPresetExport({
      name: dto.name,
      sourceType: dto.sourceType,
      entries: dto.entries ?? [],
    });
  });

  app.post('/api/prompt-presets/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!found) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    const dto = toPresetDto(found as DbPromptPreset);
    const created = await prisma.promptPreset.create({
      data: {
        name: `${dto.name} Copy`,
        sourceType: dto.sourceType,
        isActive: false,
        warningsJson: JSON.stringify(dto.warnings),
        ignoredFieldsJson: JSON.stringify(dto.ignoredFields),
        originalFileName: dto.originalFileName,
        entries: {
          create: (dto.entries ?? []).map((entry, index) => ({
            identifier: entry.identifier,
            name: entry.name,
            role: entry.role,
            enabled: entry.enabled,
            content: entry.content,
            orderIndex: index,
            marker: entry.marker,
            injectionPosition: entry.injectionPosition,
            injectionDepth: entry.injectionDepth,
            injectionOrder: entry.injectionOrder,
          })),
        },
      },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    return reply.code(201).send(toPresetDto(created as DbPromptPreset));
  });

  app.get('/api/prompt-presets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!found) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    const body: PromptPresetDetailResponse = {
      preset: toPresetDto(found as DbPromptPreset),
    };
    return body;
  });

  app.put('/api/prompt-presets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as PromptPresetUpdateRequest;
    const data: { name?: string; isActive?: boolean } = {};
    const name = optionalString(body.name);
    if (body.name !== undefined) {
      if (!name) return reply.code(400).send({ error: 'name cannot be empty' });
      data.name = name;
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const existing = await prisma.promptPreset.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    if (data.isActive === true) {
      await prisma.$transaction([
        prisma.promptPreset.updateMany({ data: { isActive: false } }),
        prisma.promptPreset.update({ where: { id }, data }),
      ]);
    } else {
      await prisma.promptPreset.update({ where: { id }, data });
    }
    const updated = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!updated) return reply.code(404).send({ error: 'prompt preset not found' });
    return toPresetDto(updated as DbPromptPreset);
  });

  app.post('/api/prompt-presets/:id/activate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.promptPreset.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    await prisma.$transaction([
      prisma.promptPreset.updateMany({ data: { isActive: false } }),
      prisma.promptPreset.update({ where: { id }, data: { isActive: true } }),
    ]);
    const updated = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    return toPresetDto(updated as DbPromptPreset);
  });

  app.put('/api/prompt-presets/:id/entries', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isPlainObject(req.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = req.body as unknown as PromptPresetEntryUpdateRequest;
    if (!Array.isArray(body.entries)) {
      return reply.code(400).send({ error: 'entries must be an array' });
    }
    const existing = await prisma.promptPreset.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    const entries = body.entries.map(normalizeEntryInput);
    await prisma.$transaction([
      prisma.promptPresetEntry.deleteMany({ where: { presetId: id } }),
      ...entries.map((entry, index) =>
        prisma.promptPresetEntry.create({
          data: {
            ...entry,
            presetId: id,
            orderIndex: index,
          },
        }),
      ),
    ]);
    const updated = await prisma.promptPreset.findUnique({
      where: { id },
      include: { entries: { orderBy: { orderIndex: 'asc' } } },
    });
    return toPresetDto(updated as DbPromptPreset);
  });

  app.delete('/api/prompt-presets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.promptPreset.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'prompt preset not found' });
    }
    await prisma.promptPreset.delete({ where: { id } });
    const body: DeletePromptPresetResponse = { ok: true, id };
    return body;
  });
}
