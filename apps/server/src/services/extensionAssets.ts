import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_EXTENSION_ASSET_BYTES = 25 * 1024 * 1024;

const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.json',
  '.txt',
]);

const RUNTIME_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
].join('; ');

export class ExtensionAssetsError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function assetsError(statusCode: number, message: string): never {
  throw new ExtensionAssetsError(statusCode, message);
}

function decodeRequestAssetPath(rawPath: string): string {
  let decoded = rawPath;
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return assetsError(400, 'Invalid extension asset path.');
  }
  return decoded;
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

function stringContainsUnsafePath(value: string): boolean {
  if (value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return true;
  }
  return value
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => segment === '..');
}

export function isSafeFeatureEntryPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes('\0') || trimmed.includes('\\')) return false;
  if (entryContainsUnsafeScheme(trimmed)) return false;
  if (stringContainsUnsafePath(trimmed)) return false;
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  return true;
}

function normalizeRequestAssetPath(rawPath: string): string {
  const decoded = decodeRequestAssetPath(rawPath).replaceAll('\\', '/');
  if (decoded.trim() === '') {
    return assetsError(400, 'Invalid extension asset path.');
  }
  if (decoded.includes('\0')) {
    return assetsError(400, 'Invalid extension asset path.');
  }
  if (entryContainsUnsafeScheme(decoded)) {
    return assetsError(400, 'Invalid extension asset path.');
  }
  if (path.posix.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) {
    return assetsError(400, 'Invalid extension asset path.');
  }
  if (/^[a-zA-Z]:/.test(decoded)) {
    return assetsError(400, 'Invalid extension asset path.');
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return assetsError(400, 'Invalid extension asset path.');
  }
  return segments.join('/');
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function resolveExtensionAssetPath(
  extensionRoot: string,
  requestPath: string,
): Promise<string> {
  const normalized = normalizeRequestAssetPath(requestPath);
  const resolvedRoot = path.resolve(extensionRoot);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (!isPathInside(resolvedRoot, resolved)) {
    return assetsError(400, 'Invalid extension asset path.');
  }

  const extension = path.extname(resolved).toLowerCase();
  if (!ALLOWED_ASSET_EXTENSIONS.has(extension)) {
    return assetsError(400, 'Extension asset type is not allowed.');
  }

  let fileInfo;
  try {
    fileInfo = await lstat(resolved);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return assetsError(404, 'Extension asset not found.');
    }
    throw error;
  }

  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    return assetsError(404, 'Extension asset not found.');
  }
  if (fileInfo.size > MAX_EXTENSION_ASSET_BYTES) {
    return assetsError(413, 'Extension asset is too large.');
  }

  const realRoot = await realpath(resolvedRoot);
  const realFile = await realpath(resolved);
  if (!isPathInside(realRoot, realFile)) {
    return assetsError(400, 'Invalid extension asset path.');
  }

  const realInfo = await lstat(realFile);
  if (!realInfo.isFile() || realInfo.isSymbolicLink()) {
    return assetsError(404, 'Extension asset not found.');
  }
  if (realInfo.size > MAX_EXTENSION_ASSET_BYTES) {
    return assetsError(413, 'Extension asset is too large.');
  }

  return realFile;
}

export function getExtensionAssetContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export function getExtensionRuntimeHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': RUNTIME_CSP,
  };
}

export async function readExtensionAssetFile(resolvedPath: string): Promise<Buffer> {
  const info = await lstat(resolvedPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    return assetsError(404, 'Extension asset not found.');
  }
  if (info.size > MAX_EXTENSION_ASSET_BYTES) {
    return assetsError(413, 'Extension asset is too large.');
  }
  return readFile(resolvedPath);
}

export function buildExtensionAssetsBaseHref(extensionId: string, entryRelativePath: string): string {
  const entryDir = path.posix.dirname(entryRelativePath.replaceAll('\\', '/'));
  const encodedId = encodeURIComponent(extensionId);
  if (entryDir === '.' || entryDir === '') {
    return `/api/extensions/${encodedId}/assets/`;
  }
  const encodedDir = entryDir
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/extensions/${encodedId}/assets/${encodedDir}/`;
}

export function injectHtmlBaseHref(html: string, baseHref: string): string {
  const escapedBaseHref = baseHref
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
  const baseTag = `<base href="${escapedBaseHref}">`;
  const headMatch = html.match(/<head(\s[^>]*)?>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}${baseTag}${html.slice(insertAt)}`;
  }
  return `${baseTag}${html}`;
}
