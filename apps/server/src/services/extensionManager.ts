import type { InstalledExtension } from '@prisma/client';
import type {
  DeleteExtensionResponse,
  ExtensionCompatibility,
  ExtensionManifestDto,
  ExtensionSourceType,
  InstalledExtensionDto,
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
import { extractZipArchive, ZipArchiveError } from './zipArchive.js';

export const MAX_EXTENSION_ZIP_BYTES = 20 * 1024 * 1024;
export const MAX_EXTENSION_MULTIPART_BYTES = MAX_EXTENSION_ZIP_BYTES + 1024 * 1024;
export const MAX_EXTENSION_UNPACKED_BYTES = 100 * 1024 * 1024;
export const MAX_EXTENSION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_EXTENSION_FILE_COUNT = 2_000;

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_GIT_CLONE_BYTES = 200 * 1024 * 1024;
const MAX_GIT_URL_LENGTH = 2_048;
const GIT_INSTALL_TIMEOUT_MS = 60_000;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

function toInstalledExtensionDto(extension: InstalledExtension): InstalledExtensionDto {
  let compatibility: ExtensionCompatibility | undefined;
  try {
    const stored = JSON.parse(extension.manifestJson) as { compatibility?: unknown };
    if (stored.compatibility === 'roleagent' || stored.compatibility === 'external') {
      compatibility = stored.compatibility;
    }
  } catch {
    // Ignore malformed stored manifest metadata.
  }

  return {
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
    createdAt: extension.createdAt.toISOString(),
    updatedAt: extension.updatedAt.toISOString(),
  };
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
  return { ...normalized, ...pathFields };
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
        installedPath,
      },
    });
    return toInstalledExtensionDto(created);
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
  return extensions.map(toInstalledExtensionDto);
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
  return toInstalledExtensionDto(updated);
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
