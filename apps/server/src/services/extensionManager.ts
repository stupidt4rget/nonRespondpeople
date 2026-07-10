import type { InstalledExtension } from '@prisma/client';
import type {
  DeleteExtensionResponse,
  ExtensionCompatibility,
  ExtensionFeatureCategory,
  ExtensionFeatureDto,
  ExtensionFeatureManifestDto,
  ExtensionFeatureRuntime,
  ExtensionManifestDto,
  ExtensionSettings,
  ExtensionSettingsResponse,
  ExtensionSourceType,
  InstalledExtensionDto,
  JsonValue,
  UpdateExtensionSettingsRequest,
} from '@roleagent/shared';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { isSafeFeatureEntryPath } from './extensionAssets.js';
import { extractZipArchive, ZipArchiveError } from './zipArchive.js';

export const MAX_EXTENSION_ZIP_BYTES = 20 * 1024 * 1024;
export const MAX_EXTENSION_MULTIPART_BYTES = MAX_EXTENSION_ZIP_BYTES + 1024 * 1024;
export const MAX_EXTENSION_UNPACKED_BYTES = 100 * 1024 * 1024;
export const MAX_EXTENSION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_EXTENSION_FILE_COUNT = 2_000;
export const MAX_EXTENSION_SETTINGS_BYTES = 256 * 1024;
export const MAX_EXTENSION_SETTINGS_REQUEST_BYTES = 300 * 1024;

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_GIT_CLONE_BYTES = 200 * 1024 * 1024;
const MAX_GIT_URL_LENGTH = 2_048;
const GIT_INSTALL_TIMEOUT_MS = 60_000;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_EXTENSION_FEATURES = 64;
const MAX_EXTENSION_SETTINGS_DEPTH = 32;
const MAX_EXTENSION_SETTINGS_NODES = 10_000;
const MAX_EXTENSION_SETTINGS_STRING_BYTES = 64 * 1024;
const MAX_EXTENSION_SETTINGS_KEY_CODE_POINTS = 256;
const FORBIDDEN_EXTENSION_SETTINGS_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const VALID_FEATURE_CATEGORIES = new Set<ExtensionFeatureCategory>([
  'render',
  'script',
  'tool',
  'optimization',
  'development',
  'other',
]);

interface GitTreeEntry {
  archivePath: string;
  objectId: string;
  size: number;
}

type ProcessFailureKind = 'missing' | 'timeout' | 'exit' | 'output-limit';

class ProcessFailure extends Error {
  constructor(readonly kind: ProcessFailureKind) {
    super('Child process failed.');
  }
}

export class ExtensionManagerError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function extensionError(statusCode: number, message: string): never {
  throw new ExtensionManagerError(statusCode, message);
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type ExtensionSettingsValidationSource = 'request' | 'stored';

interface ExtensionSettingsValidationState {
  source: ExtensionSettingsValidationSource;
  nodeCount: number;
  ancestors: WeakSet<object>;
}

function extensionSettingsValidationError(
  source: ExtensionSettingsValidationSource,
  statusCode: number,
  message: string,
): never {
  if (source === 'stored') {
    return extensionError(500, 'Stored extension compatibility settings are invalid.');
  }
  return extensionError(statusCode, message);
}

function validateExtensionSettingsNodeCount(state: ExtensionSettingsValidationState): void {
  state.nodeCount += 1;
  if (state.nodeCount > MAX_EXTENSION_SETTINGS_NODES) {
    extensionSettingsValidationError(
      state.source,
      400,
      `settings must contain at most ${MAX_EXTENSION_SETTINGS_NODES} JSON values.`,
    );
  }
}

function normalizeExtensionSettingsValue(
  value: unknown,
  depth: number,
  state: ExtensionSettingsValidationState,
): JsonValue {
  validateExtensionSettingsNodeCount(state);

  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return extensionSettingsValidationError(
        state.source,
        400,
        'settings numbers must be finite.',
      );
    }
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_EXTENSION_SETTINGS_STRING_BYTES) {
      return extensionSettingsValidationError(
        state.source,
        400,
        'settings strings must be no larger than 64 KiB.',
      );
    }
    return value;
  }
  if (typeof value !== 'object') {
    return extensionSettingsValidationError(
      state.source,
      400,
      'settings must contain only JSON values.',
    );
  }
  if (depth > MAX_EXTENSION_SETTINGS_DEPTH) {
    return extensionSettingsValidationError(
      state.source,
      400,
      `settings must not exceed ${MAX_EXTENSION_SETTINGS_DEPTH} levels of nesting.`,
    );
  }
  if (state.ancestors.has(value)) {
    return extensionSettingsValidationError(
      state.source,
      400,
      'settings must not contain circular references.',
    );
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return extensionSettingsValidationError(
          state.source,
          400,
          'settings must contain only plain JSON arrays.',
        );
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) {
          return extensionSettingsValidationError(
            state.source,
            400,
            'settings arrays must not contain custom properties.',
          );
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= value.length) {
          return extensionSettingsValidationError(
            state.source,
            400,
            'settings arrays contain an invalid index.',
          );
        }
      }

      const normalized: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return extensionSettingsValidationError(
            state.source,
            400,
            'settings arrays must be dense JSON arrays.',
          );
        }
        normalized.push(normalizeExtensionSettingsValue(descriptor.value, depth + 1, state));
      }
      return normalized;
    }

    if (!isStrictPlainObject(value)) {
      return extensionSettingsValidationError(
        state.source,
        400,
        'settings must contain only plain JSON objects.',
      );
    }

    const normalized: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        return extensionSettingsValidationError(
          state.source,
          400,
          'settings objects must not contain symbol keys.',
        );
      }
      if ([...key].length > MAX_EXTENSION_SETTINGS_KEY_CODE_POINTS) {
        return extensionSettingsValidationError(
          state.source,
          400,
          'settings keys must be at most 256 Unicode code points.',
        );
      }
      if (FORBIDDEN_EXTENSION_SETTINGS_KEYS.has(key)) {
        return extensionSettingsValidationError(
          state.source,
          400,
          'settings contain a forbidden key.',
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return extensionSettingsValidationError(
          state.source,
          400,
          'settings must contain only enumerable JSON properties.',
        );
      }
      normalized[key] = normalizeExtensionSettingsValue(descriptor.value, depth + 1, state);
    }
    return normalized;
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeExtensionSettingsDocument(
  value: unknown,
  source: ExtensionSettingsValidationSource,
): ExtensionSettings {
  if (!isStrictPlainObject(value)) {
    return extensionSettingsValidationError(source, 400, 'settings must be a JSON object.');
  }

  const normalized = normalizeExtensionSettingsValue(value, 0, {
    source,
    nodeCount: 0,
    ancestors: new WeakSet<object>(),
  });
  if (!isStrictPlainObject(normalized)) {
    return extensionSettingsValidationError(source, 400, 'settings must be a JSON object.');
  }

  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EXTENSION_SETTINGS_BYTES) {
    return extensionSettingsValidationError(
      source,
      413,
      'settings must be no larger than 256 KiB.',
    );
  }
  return normalized as ExtensionSettings;
}

function normalizeUpdateExtensionSettingsRequest(
  value: unknown,
): UpdateExtensionSettingsRequest {
  try {
    if (!isStrictPlainObject(value)) {
      return extensionError(400, 'request body must be a plain object');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'settings') {
      return extensionError(400, 'settings must be the only field in the request body');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'settings');
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return extensionError(400, 'settings must be an enumerable JSON value');
    }
    return {
      settings: normalizeExtensionSettingsDocument(descriptor.value, 'request'),
    };
  } catch (error) {
    if (error instanceof ExtensionManagerError) throw error;
    return extensionError(400, 'request body must contain only plain JSON values');
  }
}

function parseCompatSettingsJson(raw: string): ExtensionSettings {
  if (Buffer.byteLength(raw, 'utf8') > MAX_EXTENSION_SETTINGS_BYTES) {
    return extensionError(500, 'Stored extension compatibility settings are invalid.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return extensionError(500, 'Stored extension compatibility settings are invalid.');
  }
  return normalizeExtensionSettingsDocument(parsed, 'stored');
}

function isExtensionSettingsCompatibilityCandidate(extension: InstalledExtension): boolean {
  try {
    const parsed = JSON.parse(extension.manifestJson) as unknown;
    return isPlainObject(parsed) && parsed.compatibility === 'external';
  } catch {
    return false;
  }
}

function buildExtensionSettingsResponse(
  extension: InstalledExtension,
  settings: ExtensionSettings,
): ExtensionSettingsResponse {
  return {
    extensionId: extension.id,
    settings,
    updatedAt: extension.updatedAt.toISOString(),
  };
}

function isSafeExtensionId(value: string): boolean {
  return EXTENSION_ID_PATTERN.test(value);
}

function getDataDir(): string {
  const configured = process.env.ROLEAGENT_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'data');
}

export function getExtensionsDir(): string {
  return path.join(getDataDir(), 'extensions');
}

function getExtensionTempDir(): string {
  return path.join(getExtensionsDir(), '.tmp');
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertRealDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    extensionError(500, `${label} must be a real directory, not a symbolic link.`);
  }
}

async function ensureStorageDirectories(): Promise<void> {
  const extensionsDir = getExtensionsDir();
  await mkdir(extensionsDir, { recursive: true });
  await assertRealDirectory(extensionsDir, 'The extensions data directory');

  const tempDir = getExtensionTempDir();
  await mkdir(tempDir, { recursive: true });
  await assertRealDirectory(tempDir, 'The extension temporary directory');
}

async function createControlledTempDirectory(prefix: string): Promise<string> {
  await ensureStorageDirectories();
  const created = await mkdtemp(path.join(getExtensionTempDir(), `${prefix}-`));
  if (!isPathInside(getExtensionTempDir(), created)) {
    extensionError(500, 'Unable to create a safe extension temporary directory.');
  }
  return created;
}

function resolveInstalledDirectory(installedPath: string): string {
  if (!isSafeExtensionId(installedPath) || path.basename(installedPath) !== installedPath) {
    return extensionError(500, 'The stored extension path is invalid.');
  }
  const resolved = path.resolve(getExtensionsDir(), installedPath);
  if (!isPathInside(getExtensionsDir(), resolved)) {
    return extensionError(500, 'The stored extension path is outside the extensions directory.');
  }
  return resolved;
}

interface FeatureSettingsFile {
  features: Record<string, { enabled: boolean }>;
}

function parseFeatureSettingsJson(raw: string): FeatureSettingsFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.features)) {
      return { features: {} };
    }
    const features: Record<string, { enabled: boolean }> = {};
    for (const [featureId, value] of Object.entries(parsed.features)) {
      if (!FEATURE_ID_PATTERN.test(featureId) || !isPlainObject(value)) continue;
      if (typeof value.enabled !== 'boolean') continue;
      features[featureId] = { enabled: value.enabled };
    }
    return { features };
  } catch {
    return { features: {} };
  }
}

function buildInitialFeatureSettingsJson(
  manifestFeatures: ExtensionFeatureManifestDto[],
): string {
  const features: Record<string, { enabled: boolean }> = {};
  for (const feature of manifestFeatures) {
    features[feature.id] = { enabled: feature.enabledByDefault };
  }
  return JSON.stringify({ features });
}

function normalizeFeatureCategory(value: unknown): ExtensionFeatureCategory {
  const category = optionalNonEmptyString(value);
  if (category && VALID_FEATURE_CATEGORIES.has(category as ExtensionFeatureCategory)) {
    return category as ExtensionFeatureCategory;
  }
  return 'other';
}

function normalizeFeatureRuntime(
  value: unknown,
  strict: boolean,
): ExtensionFeatureRuntime | undefined {
  const runtime = optionalNonEmptyString(value) ?? 'iframe';
  if (runtime === 'iframe') return 'iframe';
  if (strict) {
    return extensionError(400, 'manifest.features[].runtime must be "iframe".');
  }
  return undefined;
}

function entryContainsUnsafeScheme(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('file:')
  );
}

function validateFeatureEntryPath(
  fieldLabel: string,
  value: string,
  extensionRoot: string,
  strict: boolean,
): string | undefined {
  if (entryContainsUnsafeScheme(value)) {
    if (strict) {
      return extensionError(400, `${fieldLabel} must not use remote, data, javascript, or file URLs.`);
    }
    return undefined;
  }
  if (value.includes('\\') || stringContainsUnsafePath(value)) {
    if (strict) {
      return extensionError(400, `${fieldLabel} must be a safe relative path.`);
    }
    return undefined;
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    if (strict) {
      return extensionError(400, `${fieldLabel} must be a safe relative path.`);
    }
    return undefined;
  }
  const normalized = segments.join('/');
  const resolved = path.resolve(extensionRoot, ...normalized.split('/'));
  if (!isPathInside(extensionRoot, resolved)) {
    if (strict) {
      return extensionError(400, `${fieldLabel} points outside the extension directory.`);
    }
    return undefined;
  }
  return normalized;
}

function isLikelyIframeEntry(entry: string): boolean {
  const lower = entry.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

function computeFeatureRunnable(
  extensionEnabled: boolean,
  featureEnabled: boolean,
  runtime: ExtensionFeatureRuntime,
  entry: string | undefined,
  displayOnly = false,
): boolean {
  if (displayOnly) return false;
  if (!extensionEnabled || !featureEnabled) return false;
  if (runtime !== 'iframe') return false;
  if (!entry) return false;
  if (!isSafeFeatureEntryPath(entry)) return false;
  if (!isLikelyIframeEntry(entry)) return false;
  return true;
}

function buildFeatureRuntimeUrl(extensionId: string, featureId: string, runnable: boolean): string | null {
  if (!runnable) return null;
  return `/api/extensions/${encodeURIComponent(extensionId)}/runtime/${encodeURIComponent(featureId)}`;
}

function buildCompatibilityNote(
  compatibility: ExtensionCompatibility,
  feature: ExtensionFeatureManifestDto,
  extensionEnabled: boolean,
  featureEnabled: boolean,
): string | null {
  if (feature.displayOnly) {
    if (feature.id === 'external-info') return EXTERNAL_INFO_NOTE;
    if (feature.id.startsWith('external-style')) return EXTERNAL_STYLE_NOTE;
    if (feature.id.startsWith('external-script')) {
      if (feature.entry && !isSafeFeatureEntryPath(feature.entry)) {
        return `${EXTERNAL_SCRIPT_NOTE} Entry path is not safe for runtime.`;
      }
      return EXTERNAL_SCRIPT_NOTE;
    }
    return EXTERNAL_INFO_NOTE;
  }

  if (
    computeFeatureRunnable(
      extensionEnabled,
      featureEnabled,
      feature.runtime,
      feature.entry,
      feature.displayOnly,
    )
  ) {
    return null;
  }

  if (!extensionEnabled) {
    return 'Extension is disabled.';
  }
  if (!featureEnabled) {
    return 'Feature is disabled.';
  }
  if (feature.runtime !== 'iframe') {
    return 'Only iframe runtime is supported in V0.16.';
  }
  if (!feature.entry) {
    if (compatibility === 'external') {
      return 'External extension has no safe iframe entry; JS/CSS injection is not supported.';
    }
    return 'Feature has no entry path.';
  }
  if (!isSafeFeatureEntryPath(feature.entry)) {
    return 'Feature entry path is not safe.';
  }
  if (!isLikelyIframeEntry(feature.entry)) {
    if (compatibility === 'external') {
      return 'External extension entry is not a safe iframe HTML entry.';
    }
    return 'Feature entry must be an HTML file for iframe runtime.';
  }
  return null;
}

function deriveDisplayNameFromAssetPath(assetPath: string, fallback: string): string {
  const base = path.posix.basename(assetPath.replaceAll('\\', '/'));
  if (base === '' || base === '.' || base === '..') return fallback;
  return base;
}

function extractManifestPathList(rawManifest: Record<string, unknown>, field: 'js' | 'css'): string[] {
  const value = rawManifest[field];
  const paths: string[] = [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') paths.push(trimmed);
    return paths;
  }
  if (!Array.isArray(value)) return paths;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed !== '') paths.push(trimmed);
  }
  return paths;
}

function hasSafeIframeEntry(entry: string | undefined): boolean {
  if (!entry) return false;
  return isSafeFeatureEntryPath(entry) && isLikelyIframeEntry(entry);
}

const EXTERNAL_SCRIPT_NOTE = 'External script detected, not fully compatible yet.';
const EXTERNAL_STYLE_NOTE = 'External style detected, not fully compatible yet.';
const EXTERNAL_INFO_NOTE = 'No RoleAgent features are available for this external extension.';

function buildExternalScriptFeature(
  assetPath: string,
  index: number,
  total: number,
): ExtensionFeatureManifestDto {
  const id = total === 1 ? 'external-script' : `external-script-${index}`;
  return {
    id,
    name: deriveDisplayNameFromAssetPath(assetPath, 'External Script'),
    category: 'script',
    entry: assetPath,
    runtime: 'iframe',
    enabledByDefault: false,
    displayOnly: true,
  };
}

function buildExternalStyleFeature(
  assetPath: string,
  index: number,
  total: number,
): ExtensionFeatureManifestDto {
  const id = total === 1 ? 'external-style' : `external-style-${index}`;
  return {
    id,
    name: deriveDisplayNameFromAssetPath(assetPath, 'External Style'),
    category: 'render',
    entry: assetPath,
    runtime: 'iframe',
    enabledByDefault: false,
    displayOnly: true,
  };
}

function synthesizeExternalDisplayFeatures(
  jsPaths: string[],
  cssPaths: string[],
): ExtensionFeatureManifestDto[] {
  const features: ExtensionFeatureManifestDto[] = [];
  jsPaths.forEach((assetPath, index) => {
    features.push(buildExternalScriptFeature(assetPath, index + 1, jsPaths.length));
  });
  cssPaths.forEach((assetPath, index) => {
    features.push(buildExternalStyleFeature(assetPath, index + 1, cssPaths.length));
  });
  if (features.length === 0) {
    features.push({
      id: 'external-info',
      name: 'External Extension',
      description: 'This extension does not expose RoleAgent-compatible features.',
      category: 'other',
      runtime: 'iframe',
      enabledByDefault: false,
      displayOnly: true,
    });
  }
  return features;
}

function resolveManifestFeatures(
  manifest: ExtensionManifestDto,
  options: {
    rawParsed?: Record<string, unknown>;
    jsPaths?: string[];
    cssPaths?: string[];
  } = {},
): ExtensionFeatureManifestDto[] {
  if (Array.isArray(manifest.features) && manifest.features.length > 0) {
    return manifest.features;
  }

  const shouldSynthesizeMain =
    Boolean(manifest.entry) &&
    (manifest.compatibility !== 'external' || hasSafeIframeEntry(manifest.entry));
  if (shouldSynthesizeMain && manifest.entry) {
    return [
      {
        id: 'main',
        name: manifest.name,
        ...(manifest.description ? { description: manifest.description } : {}),
        category: 'other',
        entry: manifest.entry,
        runtime: 'iframe',
        enabledByDefault: false,
      },
    ];
  }

  if (manifest.compatibility === 'external') {
    const jsPaths = [...(options.jsPaths ?? [])];
    const cssPaths = [...(options.cssPaths ?? [])];
    if (jsPaths.length === 0) {
      if (options.rawParsed) jsPaths.push(...extractManifestPathList(options.rawParsed, 'js'));
      if (manifest.js && !jsPaths.includes(manifest.js)) jsPaths.push(manifest.js);
    }
    if (cssPaths.length === 0) {
      if (options.rawParsed) cssPaths.push(...extractManifestPathList(options.rawParsed, 'css'));
      if (manifest.css && !cssPaths.includes(manifest.css)) cssPaths.push(manifest.css);
    }
    return synthesizeExternalDisplayFeatures(jsPaths, cssPaths);
  }

  return [];
}

async function resolveExternalAssetPaths(
  extension: InstalledExtension,
  manifest: ExtensionManifestDto,
  rawParsed: Record<string, unknown> | null,
): Promise<{ jsPaths: string[]; cssPaths: string[] }> {
  let jsPaths = rawParsed ? extractManifestPathList(rawParsed, 'js') : [];
  let cssPaths = rawParsed ? extractManifestPathList(rawParsed, 'css') : [];
  if (manifest.js && !jsPaths.includes(manifest.js)) jsPaths.push(manifest.js);
  if (manifest.css && !cssPaths.includes(manifest.css)) cssPaths.push(manifest.css);

  if (manifest.compatibility !== 'external') {
    return { jsPaths, cssPaths };
  }

  const hasRoleAgentFeatures = Array.isArray(manifest.features) && manifest.features.length > 0;
  const hasSafeEntry = hasSafeIframeEntry(manifest.entry);
  if (hasRoleAgentFeatures || hasSafeEntry || jsPaths.length > 0 || cssPaths.length > 0) {
    return { jsPaths, cssPaths };
  }

  try {
    const extensionRoot = resolveInstalledDirectory(extension.installedPath);
    const diskRaw = JSON.parse(
      await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'),
    ) as unknown;
    if (isPlainObject(diskRaw)) {
      for (const assetPath of extractManifestPathList(diskRaw, 'js')) {
        if (!jsPaths.includes(assetPath)) jsPaths.push(assetPath);
      }
      for (const assetPath of extractManifestPathList(diskRaw, 'css')) {
        if (!cssPaths.includes(assetPath)) cssPaths.push(assetPath);
      }
    }
  } catch {
    // Use manifestJson-only paths when the on-disk manifest cannot be read.
  }

  return { jsPaths, cssPaths };
}

async function buildExtensionFeatureDtos(
  extension: InstalledExtension,
  manifest: ExtensionManifestDto,
  rawParsed?: Record<string, unknown>,
): Promise<ExtensionFeatureDto[]> {
  const compatibility = manifest.compatibility;
  const settings = parseFeatureSettingsJson(extension.featureSettingsJson);
  const assetPaths = await resolveExternalAssetPaths(extension, manifest, rawParsed ?? null);
  const manifestFeatures = resolveManifestFeatures(manifest, {
    rawParsed,
    jsPaths: assetPaths.jsPaths,
    cssPaths: assetPaths.cssPaths,
  });

  return manifestFeatures.map((feature) => {
    const stored = settings.features[feature.id];
    const enabled = stored?.enabled ?? feature.enabledByDefault;
    const entry = feature.entry ?? null;
    const runnable = computeFeatureRunnable(
      extension.enabled,
      enabled,
      feature.runtime,
      feature.entry,
      feature.displayOnly,
    );
    const compatibilityNote = buildCompatibilityNote(
      compatibility,
      feature,
      extension.enabled,
      enabled,
    );

    return {
      id: feature.id,
      name: feature.name,
      description: feature.description ?? null,
      category: feature.category,
      entry,
      runtime: feature.runtime,
      enabled,
      enabledByDefault: feature.enabledByDefault,
      runnable,
      runtimeUrl: buildFeatureRuntimeUrl(extension.id, feature.id, runnable),
      compatibilityNote,
    };
  });
}

function parseStoredManifest(extension: InstalledExtension): {
  manifest: ExtensionManifestDto;
  rawParsed: Record<string, unknown> | null;
} {
  try {
    const parsed = JSON.parse(extension.manifestJson) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        manifest: {
          id: extension.id,
          name: extension.displayName,
          version: extension.version,
          type: '',
          compatibility: 'external',
        },
        rawParsed: null,
      };
    }
    const compatibility: ExtensionCompatibility =
      parsed.compatibility === 'roleagent' ? 'roleagent' : 'external';
    const manifest: ExtensionManifestDto = {
      id: extension.id,
      name: extension.displayName,
      version: extension.version,
      type: typeof parsed.type === 'string' ? parsed.type : '',
      compatibility,
      ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
      ...(typeof parsed.entry === 'string' ? { entry: parsed.entry } : {}),
      ...(typeof parsed.js === 'string' ? { js: parsed.js } : {}),
      ...(typeof parsed.css === 'string' ? { css: parsed.css } : {}),
    };
    if (Array.isArray(parsed.features)) {
      const features: ExtensionFeatureManifestDto[] = [];
      for (const item of parsed.features) {
        if (!isPlainObject(item)) continue;
        const id = optionalNonEmptyString(item.id);
        if (!id || !FEATURE_ID_PATTERN.test(id)) continue;
        const runtime = optionalNonEmptyString(item.runtime);
        if (runtime !== 'iframe') continue;
        features.push({
          id,
          name: optionalNonEmptyString(item.name) ?? id,
          ...(optionalNonEmptyString(item.description)
            ? { description: optionalNonEmptyString(item.description) }
            : {}),
          category: normalizeFeatureCategory(item.category),
          ...(optionalNonEmptyString(item.entry) ? { entry: optionalNonEmptyString(item.entry) } : {}),
          runtime: 'iframe',
          enabledByDefault: item.enabledByDefault === true,
          ...(item.displayOnly === true ? { displayOnly: true } : {}),
        });
      }
      if (features.length > 0) {
        manifest.features = features;
      }
    }
    return { manifest, rawParsed: parsed };
  } catch {
    return {
      manifest: {
        id: extension.id,
        name: extension.displayName,
        version: extension.version,
        type: '',
        compatibility: 'external',
      },
      rawParsed: null,
    };
  }
}

function toInstalledExtensionDto(extension: InstalledExtension): Promise<InstalledExtensionDto> {
  const { manifest, rawParsed } = parseStoredManifest(extension);
  const compatibility = manifest.compatibility;

  return buildExtensionFeatureDtos(extension, manifest, rawParsed ?? undefined).then((features) => ({
    id: extension.id,
    displayName: extension.displayName,
    packageName: extension.packageName,
    version: extension.version,
    author: extension.author,
    description: extension.description,
    enabled: extension.enabled,
    sourceType: extension.sourceType === 'git' ? 'git' : 'zip',
    sourceUrl: extension.sourceUrl,
    installedPath: extension.installedPath,
    ...(compatibility ? { compatibility } : {}),
    features,
    createdAt: extension.createdAt.toISOString(),
    updatedAt: extension.updatedAt.toISOString(),
  }));
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === '' || normalized.includes('\0')) return undefined;
  return normalized;
}

function sanitizeExtensionIdCandidate(value: string): string {
  let result = value.trim().toLowerCase();
  result = result.replace(/\s+/g, '-');
  result = result.replace(/[^a-z0-9_-]+/g, '-');
  result = result.replace(/-+/g, '-');
  result = result.replace(/^-+|-+$/g, '');
  if (result.length > 64) {
    result = result.slice(0, 64).replace(/-+$/g, '');
  }
  return result;
}

function deriveRepoSlugFromGitUrl(gitUrl: string): string | undefined {
  try {
    const parsed = new URL(gitUrl);
    let pathname = parsed.pathname.replace(/\/+$/g, '');
    if (pathname.endsWith('.git')) pathname = pathname.slice(0, -4);
    const segments = pathname.split('/').filter((segment) => segment !== '');
    const slug = segments[segments.length - 1];
    return slug ? slug : undefined;
  } catch {
    return undefined;
  }
}

interface NormalizeExtensionManifestOptions {
  sourceType: ExtensionSourceType;
  sourceUrl?: string;
  repoSlug?: string;
  fallbackDirectoryName?: string;
}

function deriveExtensionId(
  rawManifest: Record<string, unknown>,
  options: NormalizeExtensionManifestOptions,
): string {
  const candidates = [
    optionalNonEmptyString(rawManifest.id),
    optionalNonEmptyString(rawManifest.packageName),
    optionalNonEmptyString(rawManifest.name),
    optionalNonEmptyString(rawManifest.display_name),
    optionalNonEmptyString(rawManifest.displayName),
    options.repoSlug,
    options.fallbackDirectoryName,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const safeId = sanitizeExtensionIdCandidate(candidate);
    if (safeId && isSafeExtensionId(safeId)) return safeId;
  }

  return extensionError(
    400,
    'Extension manifest does not contain a valid id/name, and no safe id could be derived.',
  );
}

function deriveDisplayName(
  rawManifest: Record<string, unknown>,
  derivedId: string,
): string {
  const displayName =
    optionalNonEmptyString(rawManifest.name) ??
    optionalNonEmptyString(rawManifest.display_name) ??
    optionalNonEmptyString(rawManifest.displayName) ??
    optionalNonEmptyString(rawManifest.id) ??
    derivedId;
  if (displayName.length > 200) {
    return extensionError(400, 'manifest.name is too long.');
  }
  return displayName;
}

function deriveManifestVersion(rawManifest: Record<string, unknown>): string {
  const version = optionalNonEmptyString(rawManifest.version) ?? '0.0.0';
  if (version.length > 100) {
    return extensionError(400, 'manifest.version is too long.');
  }
  return version;
}

function validateManifestRelativePath(field: string, value: string): string {
  if (value.includes('\\') || stringContainsUnsafePath(value)) {
    return extensionError(400, `manifest.${field} must be a safe relative path.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return extensionError(400, `manifest.${field} must be a safe relative path.`);
  }
  return segments.join('/');
}

function validateManifestPathFields(
  rawManifest: Record<string, unknown>,
  extensionRoot: string,
): Pick<ExtensionManifestDto, 'entry' | 'js' | 'css'> {
  const result: Pick<ExtensionManifestDto, 'entry' | 'js' | 'css'> = {};
  for (const field of ['entry', 'js', 'css'] as const) {
    const rawValue = optionalNonEmptyString(rawManifest[field]);
    if (!rawValue) continue;
    if (rawValue.length > 512) {
      return extensionError(400, `manifest.${field} is too long.`);
    }
    const normalized = validateManifestRelativePath(field, rawValue);
    const resolved = path.resolve(extensionRoot, ...normalized.split('/'));
    if (!isPathInside(extensionRoot, resolved)) {
      return extensionError(400, `manifest.${field} points outside the extension directory.`);
    }
    result[field] = normalized;
  }

  const loadingOrder = rawManifest.loading_order;
  if (Array.isArray(loadingOrder)) {
    for (const item of loadingOrder) {
      if (typeof item !== 'string' || item.trim() === '') continue;
      if (stringContainsUnsafePath(item)) {
        return extensionError(400, 'manifest.loading_order contains an unsafe path.');
      }
    }
  }

  return result;
}

interface NormalizeExtensionFeaturesContext {
  id: string;
  name: string;
  description?: string;
  entry?: string;
}

function parseSingleManifestFeature(
  rawFeature: Record<string, unknown>,
  extensionRoot: string,
  strict: boolean,
): ExtensionFeatureManifestDto | undefined {
  const rawId = optionalNonEmptyString(rawFeature.id);
  if (!rawId || !FEATURE_ID_PATTERN.test(rawId)) {
    if (strict) {
      return extensionError(
        400,
        'manifest.features[].id must match /^[a-z0-9][a-z0-9_-]{0,63}$/.',
      );
    }
    return undefined;
  }

  const runtime = normalizeFeatureRuntime(rawFeature.runtime, strict);
  if (!runtime) return undefined;

  const description = optionalNonEmptyString(rawFeature.description);
  if (description && description.length > 4_000) {
    if (strict) return extensionError(400, 'manifest.features[].description is too long.');
    return undefined;
  }

  const rawEntry = optionalNonEmptyString(rawFeature.entry);
  let entry: string | undefined;
  if (rawEntry) {
    if (rawEntry.length > 512) {
      if (strict) return extensionError(400, 'manifest.features[].entry is too long.');
      return undefined;
    }
    entry = validateFeatureEntryPath(
      `manifest.features[${rawId}].entry`,
      rawEntry,
      extensionRoot,
      strict,
    );
  }

  const name = optionalNonEmptyString(rawFeature.name) ?? rawId;
  if (name.length > 200) {
    if (strict) return extensionError(400, 'manifest.features[].name is too long.');
    return undefined;
  }

  return {
    id: rawId,
    name,
    ...(description ? { description } : {}),
    category: normalizeFeatureCategory(rawFeature.category),
    ...(entry ? { entry } : {}),
    runtime,
    enabledByDefault: rawFeature.enabledByDefault === true,
  };
}

function normalizeExtensionFeatures(
  rawManifest: Record<string, unknown>,
  extensionRoot: string,
  compatibility: ExtensionCompatibility,
  context: NormalizeExtensionFeaturesContext,
  topLevelEntry?: string,
): ExtensionFeatureManifestDto[] {
  const strict = compatibility === 'roleagent';
  const rawFeatures = rawManifest.features;
  const parsed: ExtensionFeatureManifestDto[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(rawFeatures)) {
    if (rawFeatures.length > MAX_EXTENSION_FEATURES) {
      if (strict) {
        return extensionError(400, `manifest.features must contain at most ${MAX_EXTENSION_FEATURES} items.`);
      }
    }
    for (const item of rawFeatures) {
      if (!isPlainObject(item)) {
        if (strict) return extensionError(400, 'manifest.features must contain only objects.');
        continue;
      }
      const feature = parseSingleManifestFeature(item, extensionRoot, strict);
      if (!feature) continue;
      if (seenIds.has(feature.id)) {
        if (strict) {
          return extensionError(400, 'manifest.features contains duplicate feature ids.');
        }
        continue;
      }
      seenIds.add(feature.id);
      parsed.push(feature);
      if (parsed.length >= MAX_EXTENSION_FEATURES) break;
    }
  }

  if (parsed.length === 0 && topLevelEntry) {
    const entry = validateFeatureEntryPath(
      'manifest.entry',
      topLevelEntry,
      extensionRoot,
      strict,
    );
    parsed.push({
      id: 'main',
      name: context.name,
      ...(context.description ? { description: context.description } : {}),
      category: 'other',
      ...(entry ? { entry } : {}),
      runtime: 'iframe',
      enabledByDefault: false,
    });
  }

  return parsed;
}

export function normalizeExtensionManifest(
  rawManifest: Record<string, unknown>,
  options: NormalizeExtensionManifestOptions,
): ExtensionManifestDto {
  const id = deriveExtensionId(rawManifest, options);
  const name = deriveDisplayName(rawManifest, id);
  const version = deriveManifestVersion(rawManifest);
  const rawType = optionalNonEmptyString(rawManifest.type);
  const compatibility: ExtensionCompatibility =
    rawType === 'roleagent-extension' ? 'roleagent' : 'external';
  const type = rawType ?? (compatibility === 'roleagent' ? 'roleagent-extension' : '');

  const author = optionalNonEmptyString(rawManifest.author);
  if (author && author.length > 200) {
    return extensionError(400, 'manifest.author is too long.');
  }
  const description = optionalNonEmptyString(rawManifest.description);
  if (description && description.length > 4_000) {
    return extensionError(400, 'manifest.description is too long.');
  }

  return {
    id,
    name,
    version,
    compatibility,
    type,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
  };
}

function stringContainsUnsafePath(value: string): boolean {
  if (value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return true;
  }
  return value
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => segment === '..');
}

function manifestContainsUnsafePath(value: unknown): boolean {
  if (typeof value === 'string') return stringContainsUnsafePath(value);
  if (Array.isArray(value)) return value.some(manifestContainsUnsafePath);
  if (!isPlainObject(value)) return false;
  return Object.values(value).some(manifestContainsUnsafePath);
}

async function readAndValidateManifest(
  extensionRoot: string,
  options: NormalizeExtensionManifestOptions,
): Promise<ExtensionManifestDto> {
  const manifestPath = path.join(extensionRoot, 'manifest.json');
  let manifestInfo;
  try {
    manifestInfo = await lstat(manifestPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return extensionError(400, 'Extension manifest.json was not found.');
    }
    throw error;
  }

  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
    return extensionError(400, 'Extension manifest.json must be a regular file.');
  }
  if (manifestInfo.size <= 0 || manifestInfo.size > MAX_MANIFEST_BYTES) {
    return extensionError(400, 'Extension manifest.json must be between 1 byte and 64 KB.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch {
    return extensionError(400, 'Extension manifest.json is not valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    return extensionError(400, 'Extension manifest.json must contain a JSON object.');
  }
  if (manifestContainsUnsafePath(parsed)) {
    return extensionError(400, 'Extension manifest.json contains an unsafe absolute or parent path.');
  }

  const normalized = normalizeExtensionManifest(parsed, options);
  const pathFields = validateManifestPathFields(parsed, extensionRoot);
  const features = normalizeExtensionFeatures(
    parsed,
    extensionRoot,
    normalized.compatibility,
    {
      id: normalized.id,
      name: normalized.name,
      ...(normalized.description ? { description: normalized.description } : {}),
      ...(pathFields.entry ? { entry: pathFields.entry } : {}),
    },
    pathFields.entry,
  );
  return { ...normalized, ...pathFields, features };
}

async function findZipExtensionRoot(extractionRoot: string): Promise<string> {
  const directManifest = path.join(extractionRoot, 'manifest.json');
  try {
    if ((await lstat(directManifest)).isFile()) return extractionRoot;
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }

  const candidates: string[] = [];
  for (const entry of await readdir(extractionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === '__MACOSX') continue;
    const candidate = path.join(extractionRoot, entry.name);
    try {
      if ((await lstat(path.join(candidate, 'manifest.json'))).isFile()) {
        candidates.push(candidate);
      }
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
    }
  }

  if (candidates.length !== 1) {
    return extensionError(
      400,
      'The ZIP root, or its single top-level package directory, must contain manifest.json.',
    );
  }
  const candidate = candidates[0];
  if (candidate === undefined || !isPathInside(extractionRoot, candidate)) {
    return extensionError(400, 'Unable to locate a safe extension package root.');
  }
  return candidate;
}

async function copyValidatedDirectory(source: string, destination: string): Promise<void> {
  let fileCount = 0;
  let totalBytes = 0;

  async function copyDirectory(currentSource: string, currentDestination: string): Promise<void> {
    const sourceInfo = await lstat(currentSource);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      return extensionError(400, 'Extension packages may contain only regular files and directories.');
    }
    await mkdir(currentDestination, { recursive: true });

    for (const entry of await readdir(currentSource, { withFileTypes: true })) {
      const sourcePath = path.join(currentSource, entry.name);
      const destinationPath = path.join(currentDestination, entry.name);
      if (!isPathInside(source, sourcePath) || !isPathInside(destination, destinationPath)) {
        return extensionError(400, 'An extension file path escaped its controlled directory.');
      }
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) {
        return extensionError(400, 'Symbolic links are not allowed in extension packages.');
      }
      if (info.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath);
        continue;
      }
      if (!info.isFile()) {
        return extensionError(400, 'Extension packages may contain only regular files and directories.');
      }

      fileCount += 1;
      totalBytes += info.size;
      if (fileCount > MAX_EXTENSION_FILE_COUNT) {
        return extensionError(413, 'Extension archive contains too many files.');
      }
      if (info.size > MAX_EXTENSION_FILE_BYTES) {
        return extensionError(413, 'Extension file exceeds maximum unpacked size.');
      }
      if (totalBytes > MAX_EXTENSION_UNPACKED_BYTES) {
        return extensionError(413, 'Extension archive exceeds maximum unpacked size.');
      }
      await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    }
  }

  await copyDirectory(source, destination);
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'P2002';
}

async function installValidatedExtension(
  stagedRoot: string,
  manifest: ExtensionManifestDto,
  sourceType: ExtensionSourceType,
  sourceUrl: string | null,
): Promise<InstalledExtensionDto> {
  await ensureStorageDirectories();
  const existing = await prisma.installedExtension.findUnique({ where: { id: manifest.id } });
  if (existing) {
    return extensionError(409, 'Extension is already installed. Delete the existing extension first.');
  }

  const installedPath = manifest.id;
  const destination = resolveInstalledDirectory(installedPath);
  try {
    await mkdir(destination, { recursive: false });
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      return extensionError(409, 'Extension is already installed. Delete the existing extension first.');
    }
    throw error;
  }

  try {
    await copyValidatedDirectory(stagedRoot, destination);
    const manifestFeatures = manifest.features ?? [];
    const created = await prisma.installedExtension.create({
      data: {
        id: manifest.id,
        displayName: manifest.name,
        packageName: manifest.id,
        version: manifest.version,
        author: manifest.author ?? null,
        description: manifest.description ?? null,
        enabled: false,
        sourceType,
        sourceUrl,
        manifestJson: JSON.stringify(manifest),
        featureSettingsJson: buildInitialFeatureSettingsJson(manifestFeatures),
        installedPath,
      },
    });
    return await toInstalledExtensionDto(created);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    if (isPrismaUniqueConflict(error)) {
      return extensionError(409, 'Extension is already installed. Delete the existing extension first.');
    }
    throw error;
  }
}

export async function listInstalledExtensions(): Promise<InstalledExtensionDto[]> {
  const extensions = await prisma.installedExtension.findMany({
    orderBy: { updatedAt: 'desc' },
  });
  return Promise.all(extensions.map((extension) => toInstalledExtensionDto(extension)));
}

export async function installExtensionFromZip(zipBuffer: Buffer): Promise<InstalledExtensionDto> {
  if (zipBuffer.length === 0 || zipBuffer.length > MAX_EXTENSION_ZIP_BYTES) {
    return extensionError(413, 'Extension ZIP files must be no larger than 20 MB.');
  }

  const tempRoot = await createControlledTempDirectory('zip');
  const extractionRoot = path.join(tempRoot, 'extracted');
  try {
    await extractZipArchive(zipBuffer, extractionRoot, {
      maxFileCount: MAX_EXTENSION_FILE_COUNT,
      maxSingleFileBytes: MAX_EXTENSION_FILE_BYTES,
      maxTotalUnpackedBytes: MAX_EXTENSION_UNPACKED_BYTES,
    });
    const extensionRoot = await findZipExtensionRoot(extractionRoot);
    const manifest = await readAndValidateManifest(extensionRoot, {
      sourceType: 'zip',
      fallbackDirectoryName: path.basename(extensionRoot),
    });
    return await installValidatedExtension(extensionRoot, manifest, 'zip', null);
  } catch (error) {
    if (error instanceof ZipArchiveError) {
      return extensionError(400, error.message);
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function decodeUrlPath(pathname: string): string {
  let decoded = pathname;
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return extensionError(400, 'Git URL contains an invalid encoded path.');
  }
  return decoded;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  const first = octets[0];
  const second = octets[1];
  if (octets.length !== 4 || first === undefined || second === undefined) return false;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0) return false;
  return true;
}

function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  ) {
    return false;
  }
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPublicIpv4(mappedIpv4) : true;
}

async function validatePublicGitUrl(value: unknown): Promise<string> {
  if (typeof value !== 'string') {
    return extensionError(400, 'gitUrl is required and must be a string.');
  }
  const gitUrl = value.trim();
  if (gitUrl === '' || gitUrl.length > MAX_GIT_URL_LENGTH || /\s/.test(gitUrl)) {
    return extensionError(400, 'Git URL is empty, too long, or contains whitespace.');
  }
  if (
    gitUrl
      .replaceAll('\\', '/')
      .split('/')
      .some((segment) => segment === '..')
  ) {
    return extensionError(400, 'Git URL contains an unsafe repository path.');
  }

  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    return extensionError(400, 'Git URL must be a valid public HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    return extensionError(400, 'Only public HTTPS Git URLs are supported.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return extensionError(400, 'Git URLs containing credentials are not allowed.');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return extensionError(400, 'Git URL query parameters and fragments are not allowed.');
  }
  if (parsed.hostname === '' || parsed.pathname === '' || parsed.pathname === '/') {
    return extensionError(400, 'Git URL must include a public repository path.');
  }

  const decodedPath = decodeUrlPath(parsed.pathname);
  if (decodedPath.includes('\\') || stringContainsUnsafePath(decodedPath.slice(1))) {
    return extensionError(400, 'Git URL contains an unsafe repository path.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return extensionError(400, 'Git URL must use a public host.');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return extensionError(400, 'Git URL host could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    return extensionError(400, 'Git URL must resolve only to public network addresses.');
  }
  return gitUrl;
}

async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
  input?: Buffer | string;
}): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: ProcessFailureKind | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      failure = 'timeout';
      child.kill();
    }, Math.max(1, options.timeoutMs));

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    child.once('error', (error) => {
      rejectOnce(
        isErrnoException(error) && error.code === 'ENOENT'
          ? new ProcessFailure('missing')
          : error,
      );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const copy = Buffer.from(chunk);
      stdoutBytes += copy.length;
      if (stdoutBytes + stderrBytes > options.maxOutputBytes) {
        failure = 'output-limit';
        child.kill();
        return;
      }
      stdoutChunks.push(copy);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > options.maxOutputBytes) {
        failure = 'output-limit';
        child.kill();
      }
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failure) {
        reject(new ProcessFailure(failure));
      } else if (code !== 0) {
        reject(new ProcessFailure('exit'));
      } else {
        resolve(Buffer.concat(stdoutChunks));
      }
    });

    child.stdin.on('error', () => {
      // A child that exits early can close stdin before the buffered input is written.
    });
    child.stdin.end(options.input);
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}

function gitSafetyArgs(hooksDirectory: string): string[] {
  return [
    '-c',
    `core.hooksPath=${hooksDirectory}`,
    '-c',
    'credential.helper=',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'protocol.file.allow=never',
    '-c',
    'http.followRedirects=false',
  ];
}

function remainingGitTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return extensionError(504, 'Git clone timed out after 60 seconds.');
  return remaining;
}

function mapGitProcessFailure(error: unknown): never {
  if (error instanceof ProcessFailure) {
    if (error.kind === 'missing') {
      return extensionError(500, 'Git is not installed or not available in PATH.');
    }
    if (error.kind === 'timeout') {
      return extensionError(504, 'Git clone timed out after 60 seconds.');
    }
    if (error.kind === 'output-limit') {
      return extensionError(413, 'The Git repository exceeds the allowed output size.');
    }
    return extensionError(
      502,
      'Failed to clone the public Git repository. Check that the URL is reachable and public.',
    );
  }
  throw error;
}

async function measureDirectory(directory: string, maximumBytes: number): Promise<void> {
  let bytes = 0;
  let entries = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 20_000) {
        return extensionError(413, 'The Git repository contains too many internal files.');
      }
      const entryPath = path.join(current, entry.name);
      const info = await lstat(entryPath);
      if (info.isSymbolicLink()) {
        return extensionError(400, 'The cloned Git repository contains an unsafe symbolic link.');
      }
      if (info.isDirectory()) {
        pending.push(entryPath);
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > maximumBytes) {
          return extensionError(413, 'The Git repository exceeds the 200 MB clone-size limit.');
        }
      } else {
        return extensionError(400, 'The cloned Git repository contains an unsupported file type.');
      }
    }
  }
}

function decodeGitPath(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return extensionError(400, 'The Git repository contains a non-UTF-8 file path.');
  }
}

function normalizeGitTreePath(rawPath: string): string {
  if (
    rawPath === '' ||
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    path.posix.isAbsolute(rawPath) ||
    path.win32.isAbsolute(rawPath)
  ) {
    return extensionError(400, 'The Git repository contains an unsafe file path.');
  }
  const segments = rawPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return extensionError(400, 'The Git repository contains a traversal file path.');
  }
  return segments.join('/');
}

function parseGitTree(output: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let offset = 0;

  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end === -1) {
      return extensionError(400, 'Git returned a malformed repository tree.');
    }
    const record = output.subarray(offset, end);
    const tab = record.indexOf(0x09);
    if (tab === -1) {
      return extensionError(400, 'Git returned a malformed repository tree.');
    }
    const metadata = record.subarray(0, tab).toString('ascii').split(/\s+/);
    const mode = metadata[0];
    const type = metadata[1];
    const objectId = metadata[2];
    const rawSize = metadata[3];
    if (
      (mode !== '100644' && mode !== '100755') ||
      type !== 'blob' ||
      objectId === undefined ||
      !/^[0-9a-f]{40,64}$/.test(objectId) ||
      rawSize === undefined ||
      !/^\d+$/.test(rawSize)
    ) {
      return extensionError(
        400,
        'Git extensions may contain only regular files; symlinks and submodules are rejected.',
      );
    }
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXTENSION_FILE_BYTES) {
      return extensionError(413, 'Extension file exceeds maximum unpacked size.');
    }
    const archivePath = normalizeGitTreePath(decodeGitPath(record.subarray(tab + 1)));
    const collisionKey = archivePath.toLocaleLowerCase('en-US');
    if (seen.has(collisionKey)) {
      return extensionError(400, 'The Git repository contains duplicate or case-colliding paths.');
    }
    seen.add(collisionKey);
    totalBytes += size;
    if (entries.length + 1 > MAX_EXTENSION_FILE_COUNT) {
      return extensionError(413, 'Extension archive contains too many files.');
    }
    if (totalBytes > MAX_EXTENSION_UNPACKED_BYTES) {
      return extensionError(413, 'Extension archive exceeds maximum unpacked size.');
    }
    entries.push({ archivePath, objectId, size });
    offset = end + 1;
  }

  if (entries.length === 0) {
    return extensionError(400, 'The Git repository does not contain extension files.');
  }
  const files = new Set(entries.map((entry) => entry.archivePath.toLocaleLowerCase('en-US')));
  for (const entry of entries) {
    const segments = entry.archivePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      if (files.has(segments.slice(0, index).join('/').toLocaleLowerCase('en-US'))) {
        return extensionError(400, 'The Git repository contains conflicting file paths.');
      }
    }
  }
  return entries;
}

async function materializeGitTree(options: {
  repository: string;
  destination: string;
  entries: GitTreeEntry[];
  hooksDirectory: string;
  deadline: number;
}): Promise<void> {
  const batchInput = options.entries.map((entry) => `${entry.objectId}\n`).join('');
  let output: Buffer;
  try {
    output = await runProcess({
      command: 'git',
      args: [
        ...gitSafetyArgs(options.hooksDirectory),
        '-C',
        options.repository,
        'cat-file',
        '--batch',
      ],
      cwd: path.dirname(options.repository),
      timeoutMs: remainingGitTimeout(options.deadline),
      maxOutputBytes: MAX_EXTENSION_UNPACKED_BYTES + 1024 * 1024,
      env: gitEnvironment(),
      input: batchInput,
    });
  } catch (error) {
    return mapGitProcessFailure(error);
  }

  await mkdir(options.destination, { recursive: false });
  let offset = 0;
  for (const entry of options.entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      return extensionError(400, 'Git returned malformed extension file data.');
    }
    const header = output.subarray(offset, headerEnd).toString('ascii').split(' ');
    const objectId = header[0];
    const type = header[1];
    const rawSize = header[2];
    if (objectId !== entry.objectId || type !== 'blob' || Number(rawSize) !== entry.size) {
      return extensionError(400, 'Git returned inconsistent extension file data.');
    }
    const dataStart = headerEnd + 1;
    const dataEnd = dataStart + entry.size;
    if (dataEnd >= output.length || output[dataEnd] !== 0x0a) {
      return extensionError(400, 'Git returned truncated extension file data.');
    }
    const destination = path.resolve(options.destination, ...entry.archivePath.split('/'));
    if (!isPathInside(options.destination, destination)) {
      return extensionError(400, 'A Git extension path escaped its controlled directory.');
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output.subarray(dataStart, dataEnd), { flag: 'wx' });
    offset = dataEnd + 1;
  }
  if (offset !== output.length) {
    return extensionError(400, 'Git returned unexpected extension file data.');
  }
}

export async function installExtensionFromGit(gitUrlValue: unknown): Promise<InstalledExtensionDto> {
  const gitUrl = await validatePublicGitUrl(gitUrlValue);
  const tempRoot = await createControlledTempDirectory('git');
  const repository = path.join(tempRoot, 'repository');
  const hooksDirectory = path.join(tempRoot, 'disabled-hooks');
  const stagedRoot = path.join(tempRoot, 'staged');
  const deadline = Date.now() + GIT_INSTALL_TIMEOUT_MS;

  try {
    await mkdir(hooksDirectory, { recursive: false });
    try {
      await runProcess({
        command: 'git',
        args: [
          ...gitSafetyArgs(hooksDirectory),
          'clone',
          '--depth',
          '1',
          '--no-tags',
          '--single-branch',
          '--no-checkout',
          '--',
          gitUrl,
          repository,
        ],
        cwd: tempRoot,
        timeoutMs: remainingGitTimeout(deadline),
        maxOutputBytes: 1024 * 1024,
        env: gitEnvironment(),
      });
    } catch (error) {
      return mapGitProcessFailure(error);
    }

    await measureDirectory(repository, MAX_GIT_CLONE_BYTES);
    let treeOutput: Buffer;
    try {
      treeOutput = await runProcess({
        command: 'git',
        args: [
          ...gitSafetyArgs(hooksDirectory),
          '-C',
          repository,
          'ls-tree',
          '-r',
          '-z',
          '--full-tree',
          '--long',
          'HEAD',
        ],
        cwd: tempRoot,
        timeoutMs: remainingGitTimeout(deadline),
        maxOutputBytes: 10 * 1024 * 1024,
        env: gitEnvironment(),
      });
    } catch (error) {
      return mapGitProcessFailure(error);
    }
    const treeEntries = parseGitTree(treeOutput);
    await materializeGitTree({
      repository,
      destination: stagedRoot,
      entries: treeEntries,
      hooksDirectory,
      deadline,
    });
    const manifest = await readAndValidateManifest(stagedRoot, {
      sourceType: 'git',
      sourceUrl: gitUrl,
      repoSlug: deriveRepoSlugFromGitUrl(gitUrl),
      fallbackDirectoryName: deriveRepoSlugFromGitUrl(gitUrl),
    });
    return await installValidatedExtension(stagedRoot, manifest, 'git', gitUrl);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export interface ExtensionRuntimeContext {
  extensionId: string;
  featureId: string;
  extensionRoot: string;
  entryRelativePath: string;
}

export async function getInstalledExtensionForAssets(
  extensionId: string,
): Promise<{ extensionRoot: string }> {
  const existing = await prisma.installedExtension.findUnique({ where: { id: extensionId } });
  if (!existing) return extensionError(404, 'Extension not found.');
  if (!existing.enabled) return extensionError(403, 'Extension is disabled.');
  return { extensionRoot: resolveInstalledDirectory(existing.installedPath) };
}

export async function getInstalledExtensionRuntime(
  extensionId: string,
  featureId: string,
): Promise<ExtensionRuntimeContext> {
  const existing = await prisma.installedExtension.findUnique({ where: { id: extensionId } });
  if (!existing) return extensionError(404, 'Extension not found.');
  if (!existing.enabled) return extensionError(403, 'Extension is disabled.');

  const { manifest, rawParsed } = parseStoredManifest(existing);
  const assetPaths = await resolveExternalAssetPaths(existing, manifest, rawParsed);
  const manifestFeatures = resolveManifestFeatures(manifest, {
    ...(rawParsed ? { rawParsed } : {}),
    jsPaths: assetPaths.jsPaths,
    cssPaths: assetPaths.cssPaths,
  });
  const feature = manifestFeatures.find((item) => item.id === featureId);
  if (!feature) return extensionError(404, 'Extension feature not found.');

  const settings = parseFeatureSettingsJson(existing.featureSettingsJson);
  const featureEnabled = settings.features[featureId]?.enabled ?? feature.enabledByDefault;
  if (!featureEnabled) return extensionError(403, 'Extension feature is disabled.');
  if (feature.displayOnly) return extensionError(403, 'Extension feature is not runnable.');
  if (feature.runtime !== 'iframe') {
    return extensionError(403, 'Extension feature is not runnable.');
  }
  if (!feature.entry) return extensionError(403, 'Extension feature is not runnable.');
  if (!isSafeFeatureEntryPath(feature.entry)) {
    return extensionError(400, 'Invalid extension asset path.');
  }
  if (!isLikelyIframeEntry(feature.entry)) {
    return extensionError(403, 'Extension feature is not runnable.');
  }

  return {
    extensionId: existing.id,
    featureId: feature.id,
    extensionRoot: resolveInstalledDirectory(existing.installedPath),
    entryRelativePath: feature.entry,
  };
}

export async function getExtensionSettings(
  extensionId: string,
): Promise<ExtensionSettingsResponse> {
  const existing = await prisma.installedExtension.findUnique({ where: { id: extensionId } });
  if (!existing) return extensionError(404, 'Extension not found.');

  const settings = parseCompatSettingsJson(existing.compatSettingsJson);
  return buildExtensionSettingsResponse(existing, settings);
}

export async function updateExtensionSettings(
  extensionId: string,
  request: unknown,
): Promise<ExtensionSettingsResponse> {
  const existing = await prisma.installedExtension.findUnique({ where: { id: extensionId } });
  if (!existing) return extensionError(404, 'Extension not found.');
  if (!existing.enabled) return extensionError(403, 'Extension is disabled.');
  if (!isExtensionSettingsCompatibilityCandidate(existing)) {
    return extensionError(409, 'Extension is not a compatibility runtime candidate.');
  }

  const normalized = normalizeUpdateExtensionSettingsRequest(request);
  const updated = await prisma.installedExtension.update({
    where: { id: extensionId },
    data: {
      compatSettingsJson: JSON.stringify(normalized.settings),
    },
  });
  return buildExtensionSettingsResponse(updated, normalized.settings);
}

export async function updateExtensionEnabled(
  id: string,
  enabled: boolean,
): Promise<InstalledExtensionDto> {
  const existing = await prisma.installedExtension.findUnique({ where: { id } });
  if (!existing) return extensionError(404, 'Extension not found.');
  const updated = await prisma.installedExtension.update({
    where: { id },
    data: { enabled },
  });
  return await toInstalledExtensionDto(updated);
}

export async function updateExtensionFeatureEnabled(
  extensionId: string,
  featureId: string,
  enabled: boolean,
): Promise<InstalledExtensionDto> {
  const existing = await prisma.installedExtension.findUnique({ where: { id: extensionId } });
  if (!existing) return extensionError(404, 'Extension not found.');

  const { manifest, rawParsed } = parseStoredManifest(existing);
  const assetPaths = await resolveExternalAssetPaths(existing, manifest, rawParsed);
  const manifestFeatures = resolveManifestFeatures(manifest, {
    ...(rawParsed ? { rawParsed } : {}),
    jsPaths: assetPaths.jsPaths,
    cssPaths: assetPaths.cssPaths,
  });
  if (!manifestFeatures.some((feature) => feature.id === featureId)) {
    return extensionError(404, 'Extension feature not found.');
  }

  const settings = parseFeatureSettingsJson(existing.featureSettingsJson);
  settings.features[featureId] = { enabled };

  const updated = await prisma.installedExtension.update({
    where: { id: extensionId },
    data: {
      featureSettingsJson: JSON.stringify(settings),
    },
  });
  return await toInstalledExtensionDto(updated);
}

export async function deleteInstalledExtension(id: string): Promise<DeleteExtensionResponse> {
  await ensureStorageDirectories();
  const existing = await prisma.installedExtension.findUnique({ where: { id } });
  if (!existing) return extensionError(404, 'Extension not found.');
  if (existing.id !== existing.packageName || existing.installedPath !== existing.packageName) {
    return extensionError(500, 'The stored extension identity and installation path do not match.');
  }

  const installedDirectory = resolveInstalledDirectory(existing.installedPath);
  const trashDirectory = path.join(getExtensionTempDir(), `delete-${randomUUID()}`);
  let movedToTrash = false;
  try {
    try {
      const info = await lstat(installedDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        return extensionError(500, 'The installed extension path is not a safe directory.');
      }
      const [realExtensionsRoot, realInstalledDirectory] = await Promise.all([
        realpath(getExtensionsDir()),
        realpath(installedDirectory),
      ]);
      if (!isPathInside(realExtensionsRoot, realInstalledDirectory)) {
        return extensionError(500, 'The installed extension path escaped the extensions directory.');
      }
      await rename(installedDirectory, trashDirectory);
      movedToTrash = true;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
    }

    await prisma.installedExtension.delete({ where: { id } });
  } catch (error) {
    if (movedToTrash) {
      try {
        await rename(trashDirectory, installedDirectory);
      } catch {
        // Preserve the original failure; the controlled temporary copy remains recoverable.
      }
    }
    throw error;
  }

  if (movedToTrash) {
    await rm(trashDirectory, { recursive: true, force: true });
  }
  return { ok: true, id };
}
