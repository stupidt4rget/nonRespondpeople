import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ExtensionsResponse,
  InstallExtensionFromGitRequest,
  InstallExtensionFromGitResponse,
  InstallExtensionFromZipResponse,
  UpdateExtensionFeatureRequest,
  UpdateExtensionRequest,
} from '@roleagent/shared';
import path from 'node:path';
import {
  buildExtensionAssetsBaseHref,
  ExtensionAssetsError,
  getExtensionAssetContentType,
  getExtensionRuntimeHeaders,
  injectHtmlBaseHref,
  readExtensionAssetFile,
  resolveExtensionAssetPath,
} from '../services/extensionAssets.js';
import { getExtensionCompatRuntime } from '../services/extensionCompatRuntime.js';
import {
  deleteInstalledExtension,
  ExtensionManagerError,
  getExtensionSettings,
  getInstalledExtensionForAssets,
  getInstalledExtensionRuntime,
  installExtensionFromGit,
  installExtensionFromZip,
  listInstalledExtensions,
  MAX_EXTENSION_MULTIPART_BYTES,
  MAX_EXTENSION_SETTINGS_REQUEST_BYTES,
  MAX_EXTENSION_ZIP_BYTES,
  updateExtensionEnabled,
  updateExtensionFeatureEnabled,
  updateExtensionSettings,
} from '../services/extensionManager.js';

interface UploadedZip {
  filename: string;
  data: Buffer;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function multipartError(message: string): never {
  throw new ExtensionManagerError(400, message);
}

function parseBoundary(contentType: string): string {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (
    boundary === undefined ||
    boundary.length === 0 ||
    boundary.length > 70 ||
    !/^[0-9A-Za-z'()+_,./:=?-]+$/.test(boundary)
  ) {
    return multipartError('The multipart upload boundary is missing or invalid.');
  }
  return boundary;
}

function findNextMultipartBoundary(
  body: Buffer,
  marker: Buffer,
  fromOffset: number,
): number {
  const searchMarker = Buffer.concat([Buffer.from('\r\n'), marker]);
  let found = body.indexOf(searchMarker, fromOffset);
  while (found !== -1) {
    const suffixOffset = found + searchMarker.length;
    const suffix = body.subarray(suffixOffset, suffixOffset + 2).toString('ascii');
    if (suffix === '--' || suffix === '\r\n') return found;
    found = body.indexOf(searchMarker, found + 1);
  }
  return multipartError('The multipart upload is incomplete.');
}

function parseContentDisposition(value: string): {
  fieldName: string | null;
  filename: string | null;
} {
  if (!/^form-data(?:;|$)/i.test(value.trim())) {
    return { fieldName: null, filename: null };
  }
  const fieldName = value.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] ?? null;
  const filename = value.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] ?? null;
  return { fieldName, filename };
}

function parseMultipartZip(body: Buffer, contentType: string): UploadedZip {
  const boundary = parseBoundary(contentType);
  const marker = Buffer.from(`--${boundary}`, 'ascii');
  if (!body.subarray(0, marker.length).equals(marker)) {
    return multipartError('The multipart upload does not start with its declared boundary.');
  }

  let cursor = marker.length;
  let uploaded: UploadedZip | null = null;
  while (cursor < body.length) {
    const markerSuffix = body.subarray(cursor, cursor + 2).toString('ascii');
    if (markerSuffix === '--') break;
    if (markerSuffix !== '\r\n') {
      return multipartError('The multipart upload contains a malformed boundary.');
    }
    cursor += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1 || headerEnd - cursor > 16 * 1024) {
      return multipartError('The multipart upload contains invalid part headers.');
    }
    const headerLines = body.subarray(cursor, headerEnd).toString('utf8').split('\r\n');
    const headers = new Map<string, string>();
    for (const line of headerLines) {
      const separator = line.indexOf(':');
      if (separator <= 0) return multipartError('The multipart upload contains an invalid header.');
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }

    const dataStart = headerEnd + 4;
    const boundaryOffset = findNextMultipartBoundary(body, marker, dataStart);
    const disposition = parseContentDisposition(headers.get('content-disposition') ?? '');
    if (disposition.filename !== null) {
      if (uploaded !== null) {
        return multipartError('Upload exactly one extension ZIP file at a time.');
      }
      if (disposition.fieldName !== 'file') {
        return multipartError('The extension ZIP must use the multipart field name "file".');
      }
      if (disposition.filename.includes('\0')) {
        return multipartError('The uploaded ZIP filename is invalid.');
      }
      const filename = path.win32.basename(disposition.filename);
      if (path.extname(filename).toLowerCase() !== '.zip') {
        return multipartError('Only files with the .zip extension can be installed.');
      }
      const data = body.subarray(dataStart, boundaryOffset);
      if (data.length === 0 || data.length > MAX_EXTENSION_ZIP_BYTES) {
        throw new ExtensionManagerError(
          413,
          'Extension ZIP files must be no larger than 20 MB.',
        );
      }
      uploaded = { filename, data };
    }
    cursor = boundaryOffset + 2 + marker.length;
  }

  if (uploaded === null) {
    return multipartError('No extension ZIP file was uploaded.');
  }
  return uploaded;
}

async function sendExtensionError(
  app: FastifyInstance,
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof ExtensionManagerError || error instanceof ExtensionAssetsError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  app.log.error(error);
  return reply.code(500).send({ error: 'Extension operation failed.' });
}

function applyExtensionAssetHeaders(reply: FastifyReply): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'no-store');
}

function getErrorStatusCode(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function sendExtensionSettingsBodyError(
  app: FastifyInstance,
  reply: FastifyReply,
  error: unknown,
): void {
  const statusCode = getErrorStatusCode(error);
  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    const message =
      statusCode === 413
        ? 'Extension settings request is too large.'
        : 'Invalid extension settings request body.';
    void reply.code(statusCode).send({ error: message });
    return;
  }
  void sendExtensionError(app, reply, error);
}

export async function extensionRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: MAX_EXTENSION_MULTIPART_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.get('/api/extensions', async () => {
    const body: ExtensionsResponse = {
      extensions: await listInstalledExtensions(),
    };
    return body;
  });

  app.get('/api/extensions/:id/settings', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = request.params as { id: string };
    try {
      return await getExtensionSettings(id);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.get('/api/extensions/:id/compat-runtime', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const runtime = await getExtensionCompatRuntime(id);
      for (const [name, value] of Object.entries(runtime.headers)) {
        reply.header(name, value);
      }
      return reply.send(runtime.html);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.get('/api/extensions/:id/assets/*', async (request, reply) => {
    try {
      const params = request.params as { id: string; '*': string };
      const assetPath = params['*'] ?? '';
      if (assetPath.trim() === '') {
        return reply.code(400).send({ error: 'Invalid extension asset path.' });
      }
      const { extensionRoot } = await getInstalledExtensionForAssets(params.id);
      const resolvedPath = await resolveExtensionAssetPath(extensionRoot, assetPath);
      const content = await readExtensionAssetFile(resolvedPath);
      applyExtensionAssetHeaders(reply);
      if (request.headers.origin === 'null') {
        reply.header('Access-Control-Allow-Origin', 'null');
        reply.header('Vary', 'Origin');
      }
      return reply
        .type(getExtensionAssetContentType(resolvedPath))
        .send(content);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.get('/api/extensions/:id/runtime/:featureId', async (request, reply) => {
    try {
      const { id, featureId } = request.params as { id: string; featureId: string };
      const runtime = await getInstalledExtensionRuntime(id, featureId);
      const resolvedPath = await resolveExtensionAssetPath(
        runtime.extensionRoot,
        runtime.entryRelativePath,
      );
      const content = await readExtensionAssetFile(resolvedPath);
      const baseHref = buildExtensionAssetsBaseHref(runtime.extensionId, runtime.entryRelativePath);
      const html = injectHtmlBaseHref(content.toString('utf8'), baseHref);
      const headers = getExtensionRuntimeHeaders();
      for (const [name, value] of Object.entries(headers)) {
        reply.header(name, value);
      }
      return reply.type('text/html; charset=utf-8').send(html);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.post('/api/extensions/install-zip', async (request, reply) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: 'Expected a multipart ZIP upload.' });
      }
      const contentType = request.headers['content-type'];
      if (typeof contentType !== 'string') {
        return reply.code(400).send({ error: 'Multipart Content-Type is required.' });
      }
      const upload = parseMultipartZip(request.body, contentType);
      const extension = await installExtensionFromZip(upload.data);
      const body: InstallExtensionFromZipResponse = { extension };
      return reply.code(201).send(body);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.post('/api/extensions/install-git', async (request, reply) => {
    try {
      if (!isPlainObject(request.body)) {
        return reply.code(400).send({ error: 'request body must be an object' });
      }
      const body = request.body as unknown as InstallExtensionFromGitRequest;
      const extension = await installExtensionFromGit(body.gitUrl);
      const response: InstallExtensionFromGitResponse = { extension };
      return reply.code(201).send(response);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.patch('/api/extensions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isPlainObject(request.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = request.body as unknown as UpdateExtensionRequest;
    if (typeof body.enabled !== 'boolean' || Object.keys(request.body).some((key) => key !== 'enabled')) {
      return reply.code(400).send({ error: 'enabled must be the only field and must be boolean' });
    }
    try {
      return await updateExtensionEnabled(id, body.enabled);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.patch(
    '/api/extensions/:id/settings',
    {
      bodyLimit: MAX_EXTENSION_SETTINGS_REQUEST_BYTES,
      errorHandler(error, _request, reply) {
        sendExtensionSettingsBodyError(app, reply, error);
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { id } = request.params as { id: string };
      try {
        return await updateExtensionSettings(id, request.body);
      } catch (error) {
        return sendExtensionError(app, reply, error);
      }
    },
  );

  app.patch('/api/extensions/:id/features/:featureId', async (request, reply) => {
    const { id, featureId } = request.params as { id: string; featureId: string };
    if (!isPlainObject(request.body)) {
      return reply.code(400).send({ error: 'request body must be an object' });
    }
    const body = request.body as unknown as UpdateExtensionFeatureRequest;
    if (typeof body.enabled !== 'boolean' || Object.keys(request.body).some((key) => key !== 'enabled')) {
      return reply.code(400).send({ error: 'enabled must be the only field and must be boolean' });
    }
    try {
      return await updateExtensionFeatureEnabled(id, featureId, body.enabled);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });

  app.delete('/api/extensions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await deleteInstalledExtension(id);
    } catch (error) {
      return sendExtensionError(app, reply, error);
    }
  });
}
