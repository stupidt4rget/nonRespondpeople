import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import {
  isSafeFeatureEntryPath,
  resolveExtensionAssetPath,
} from './extensionAssets.js';
import {
  ExtensionManagerError,
  getInstalledExtensionForAssets,
} from './extensionManager.js';

const COMPAT_PROTOCOL_VERSION = 1;
const MAX_MANIFEST_ASSET_PATH_LENGTH = 512;

interface ExtensionCompatRuntimeDocument {
  html: string;
  headers: Record<string, string>;
}

function compatError(statusCode: number, message: string): never {
  throw new ExtensionManagerError(statusCode, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseCompatManifest(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return compatError(409, 'Extension manifest is not a compatibility runtime candidate.');
  }
  if (!isPlainObject(parsed)) {
    return compatError(409, 'Extension manifest is not a compatibility runtime candidate.');
  }
  if (parsed.compatibility !== 'external' || parsed.type === 'roleagent-extension') {
    return compatError(409, 'Extension is not a compatibility runtime candidate.');
  }
  return parsed;
}

function readManifestAssetEntry(
  manifest: Record<string, unknown>,
  field: 'js' | 'css',
  required: boolean,
): string | null {
  const value = manifest[field];
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    if (required) {
      return compatError(409, 'Extension manifest does not declare a JavaScript entry.');
    }
    return compatError(409, `Extension manifest.${field} is not a safe asset entry.`);
  }

  const entry = value.trim();
  const allowedExtensions = field === 'js' ? ['.js', '.mjs'] : ['.css'];
  const entryExt = path.posix.extname(entry).toLowerCase();
  if (
    entry.length > MAX_MANIFEST_ASSET_PATH_LENGTH ||
    !isSafeFeatureEntryPath(entry) ||
    !allowedExtensions.includes(entryExt)
  ) {
    return compatError(409, `Extension manifest.${field} is not a safe ${allowedExtensions.join(' or ')} entry.`);
  }
  return entry;
}

function buildExtensionAssetUrl(extensionId: string, entry: string): string {
  const encodedEntry = entry
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/extensions/${encodeURIComponent(extensionId)}/assets/${encodedEntry}`;
}

function serializeForInlineScript(value: string | null): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function buildCompatRuntimeCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'none'",
    "connect-src 'none'",
  ].join('; ');
}

function buildCompatRuntimeHtml(
  extensionId: string,
  jsUrl: string,
  cssUrl: string | null,
  nonce: string,
): string {
  const serializedExtensionId = serializeForInlineScript(extensionId);
  const serializedJsUrl = serializeForInlineScript(jsUrl);
  const serializedCssUrl = serializeForInlineScript(cssUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RoleAgent Extension Compatibility Runtime</title>
</head>
<body>
  <div id="extensions_settings"></div>
  <div id="extensions_settings2"></div>
  <div id="roleagent-compat-status" role="status">Waiting for host initialization.</div>
  <script nonce="${nonce}">
  'use strict';
  (function () {
    var activeScript = document.currentScript;
    if (activeScript) activeScript.removeAttribute('nonce');

    var PROTOCOL_VERSION = ${COMPAT_PROTOCOL_VERSION};
    var EXTENSION_ID = ${serializedExtensionId};
    var PLUGIN_JS_URL = ${serializedJsUrl};
    var PLUGIN_CSS_URL = ${serializedCssUrl};
    var MAX_TEXT_LENGTH = 2048;
    var MAX_SETTINGS_BYTES = 256 * 1024;
    var MAX_SETTINGS_DEPTH = 32;
    var MAX_SETTINGS_NODES = 10000;
    var MAX_STRING_BYTES = 64 * 1024;
    var MAX_KEY_CODE_POINTS = 256;
    var SAVE_DEBOUNCE_MS = 500;
    var INIT_TIMEOUT_MS = 10000;
    var FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    var statusElement = document.getElementById('roleagent-compat-status');
    var extensionSettings = Object.create(null);
    var initialized = false;
    var shuttingDown = false;
    var sessionId = null;
    var saveTimer = null;
    var pendingRequestId = null;
    var queuedSettings = null;
    var saveSequence = 0;
    var logWindowStartedAt = Date.now();
    var logCount = 0;

    function isPlainObject(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      var prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }

    function hasOnlyKeys(value, allowed) {
      var keys = Reflect.ownKeys(value);
      if (keys.some(function (key) { return typeof key !== 'string'; })) return false;
      return keys.every(function (key) { return allowed.indexOf(key) !== -1; });
    }

    function truncateText(value) {
      var text = typeof value === 'string' ? value : String(value);
      return text.length <= MAX_TEXT_LENGTH ? text : text.slice(0, MAX_TEXT_LENGTH);
    }

    function postToHost(type, payload) {
      var message = Object.assign({
        type: type,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: sessionId,
      }, payload || {});
      window.parent.postMessage(message, '*');
    }

    function reportStatus(status, message) {
      var safeStatus = truncateText(status);
      var safeMessage = truncateText(message);
      if (statusElement) statusElement.textContent = safeMessage;
      postToHost('roleagent:compat:status', {
        status: safeStatus,
        message: safeMessage,
      });
    }

    function logValue(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value);
      }
      if (value instanceof Error) return value.name + ': ' + value.message;
      return '[non-primitive value]';
    }

    function reportLog(level, values) {
      var now = Date.now();
      if (now - logWindowStartedAt >= 10000) {
        logWindowStartedAt = now;
        logCount = 0;
      }
      if (logCount >= 20) return;
      logCount += 1;
      var message = values.map(logValue).join(' ');
      postToHost('roleagent:compat:log', {
        level: level,
        message: truncateText(message),
      });
    }

    ['log', 'info', 'warn', 'error'].forEach(function (method) {
      var original = console[method].bind(console);
      console[method] = function () {
        var values = Array.prototype.slice.call(arguments);
        original.apply(console, values);
        reportLog(method === 'log' ? 'info' : method, values);
      };
    });

    window.addEventListener('error', function (event) {
      reportLog('error', [event.message || 'Compatibility runtime error.']);
    });

    window.addEventListener('unhandledrejection', function (event) {
      reportLog('error', [
        event.reason instanceof Error
          ? event.reason.message
          : 'Unhandled compatibility runtime rejection.',
      ]);
    });

    function validationError(message) {
      throw new Error(message);
    }

    function validateNodeCount(state) {
      state.nodes += 1;
      if (state.nodes > MAX_SETTINGS_NODES) {
        validationError('Settings contain too many JSON values.');
      }
    }

    function cloneJsonValue(value, depth, state) {
      validateNodeCount(state);
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) validationError('Settings numbers must be finite.');
        return value;
      }
      if (typeof value === 'string') {
        if (new TextEncoder().encode(value).byteLength > MAX_STRING_BYTES) {
          validationError('Settings strings are too large.');
        }
        return value;
      }
      if (typeof value !== 'object') validationError('Settings contain a non-JSON value.');
      if (depth > MAX_SETTINGS_DEPTH) validationError('Settings are nested too deeply.');
      if (state.ancestors.has(value)) validationError('Settings contain a circular reference.');

      state.ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          if (Object.getPrototypeOf(value) !== Array.prototype) {
            validationError('Settings contain a non-plain array.');
          }
          var ownKeys = Reflect.ownKeys(value);
          ownKeys.forEach(function (key) {
            if (key === 'length') return;
            if (typeof key !== 'string' || !/^(0|[1-9]\\d*)$/.test(key)) {
              validationError('Settings arrays contain custom properties.');
            }
          });
          var arrayResult = [];
          for (var index = 0; index < value.length; index += 1) {
            var arrayDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!arrayDescriptor || !arrayDescriptor.enumerable || !('value' in arrayDescriptor)) {
              validationError('Settings arrays must be dense.');
            }
            arrayResult.push(cloneJsonValue(arrayDescriptor.value, depth + 1, state));
          }
          return arrayResult;
        }

        if (!isPlainObject(value)) validationError('Settings contain a non-plain object.');
        var objectResult = Object.create(null);
        Reflect.ownKeys(value).forEach(function (key) {
          if (typeof key !== 'string') validationError('Settings contain a symbol key.');
          if (Array.from(key).length > MAX_KEY_CODE_POINTS) {
            validationError('Settings contain an overlong key.');
          }
          if (FORBIDDEN_KEYS.has(key)) validationError('Settings contain a forbidden key.');
          var descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            validationError('Settings contain a non-JSON property.');
          }
          objectResult[key] = cloneJsonValue(descriptor.value, depth + 1, state);
        });
        return objectResult;
      } finally {
        state.ancestors.delete(value);
      }
    }

    function cloneSettingsDocument(value) {
      if (!isPlainObject(value)) validationError('Settings must be a JSON object.');
      var cloned = cloneJsonValue(value, 0, {
        nodes: 0,
        ancestors: new WeakSet(),
      });
      var serialized = JSON.stringify(cloned);
      if (new TextEncoder().encode(serialized).byteLength > MAX_SETTINGS_BYTES) {
        validationError('Settings exceed the 256 KiB limit.');
      }
      return cloned;
    }

    function replaceExtensionSettings(settings) {
      Reflect.ownKeys(extensionSettings).forEach(function (key) {
        delete extensionSettings[key];
      });
      Object.keys(settings).forEach(function (key) {
        extensionSettings[key] = settings[key];
      });
    }

    function sendSettingsSnapshot(settings) {
      if (!initialized || shuttingDown) return;
      saveSequence += 1;
      pendingRequestId = sessionId + ':' + String(saveSequence);
      postToHost('roleagent:compat:save-settings', {
        requestId: pendingRequestId,
        settings: settings,
      });
      reportStatus('saving', 'Saving compatibility settings.');
    }

    function prepareSettingsSave() {
      if (!initialized || shuttingDown) return;
      var snapshot;
      try {
        snapshot = cloneSettingsDocument(extensionSettings);
      } catch (error) {
        reportStatus('degraded', error instanceof Error ? error.message : 'Settings are invalid.');
        return;
      }
      if (pendingRequestId !== null) {
        queuedSettings = snapshot;
        reportStatus('saving', 'A newer settings snapshot is queued.');
        return;
      }
      sendSettingsSnapshot(snapshot);
    }

    function saveSettingsDebounced() {
      if (!initialized || shuttingDown) return;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(function () {
        saveTimer = null;
        prepareSettingsSave();
      }, SAVE_DEBOUNCE_MS);
    }

    function installFakeSillyTavernEnvironment() {
      var context = Object.freeze({
        extensionSettings: extensionSettings,
        saveSettingsDebounced: saveSettingsDebounced,
      });
      Object.defineProperty(window, 'extension_settings', {
        value: extensionSettings,
        configurable: false,
        enumerable: true,
        writable: false,
      });
      Object.defineProperty(window, 'saveSettingsDebounced', {
        value: saveSettingsDebounced,
        configurable: false,
        enumerable: true,
        writable: false,
      });
      Object.defineProperty(window, 'SillyTavern', {
        value: Object.freeze({
          getContext: function () { return context; },
        }),
        configurable: false,
        enumerable: true,
        writable: false,
      });
    }

    function loadStylesheet() {
      if (PLUGIN_CSS_URL === null) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = PLUGIN_CSS_URL;
        link.referrerPolicy = 'no-referrer';
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', function () {
          reject(new Error('Declared extension stylesheet failed to load.'));
        }, { once: true });
        document.head.appendChild(link);
      });
    }

    function loadModuleScript() {
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.type = 'module';
        script.src = PLUGIN_JS_URL;
        script.referrerPolicy = 'no-referrer';
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', function () {
          reject(new Error('Declared extension module failed to load.'));
        }, { once: true });
        document.head.appendChild(script);
      });
    }

    async function loadDeclaredExtensionAssets() {
      reportStatus('loading-plugin', 'Loading declared compatibility extension assets.');
      try {
        await loadStylesheet();
        await loadModuleScript();
        reportStatus('ready', 'Compatibility runtime loaded. Unsupported APIs remain unavailable.');
        postToHost('roleagent:compat:runtime-ready', { level: 'L2' });
      } catch (error) {
        var message = error instanceof Error ? error.message : 'Extension assets failed to load.';
        reportLog('error', [message]);
        reportStatus('degraded', message);
      }
    }

    function handleInit(data) {
      if (initialized || shuttingDown) {
        reportStatus('degraded', 'Duplicate compatibility init was rejected.');
        return;
      }
      if (!hasOnlyKeys(data, ['type', 'protocolVersion', 'sessionId', 'extensionId', 'settings'])) {
        reportStatus('degraded', 'Compatibility init contains unsupported fields.');
        return;
      }
      if (
        typeof data.sessionId !== 'string' ||
        data.sessionId.length < 16 ||
        data.sessionId.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(data.sessionId) ||
        data.extensionId !== EXTENSION_ID
      ) {
        reportStatus('degraded', 'Compatibility init identity was rejected.');
        return;
      }

      var settings;
      try {
        settings = cloneSettingsDocument(data.settings);
      } catch (error) {
        reportStatus('degraded', error instanceof Error ? error.message : 'Invalid init settings.');
        return;
      }

      sessionId = data.sessionId;
      initialized = true;
      window.clearTimeout(initTimeout);
      replaceExtensionSettings(settings);
      installFakeSillyTavernEnvironment();
      reportStatus('initialized', 'Compatibility environment initialized.');
      void loadDeclaredExtensionAssets();
    }

    function handleSaveResult(data) {
      if (!initialized || shuttingDown || data.sessionId !== sessionId) return;
      if (!hasOnlyKeys(data, [
        'type',
        'protocolVersion',
        'sessionId',
        'requestId',
        'ok',
        'error',
        'updatedAt',
      ])) return;
      if (
        typeof data.requestId !== 'string' ||
        data.requestId !== pendingRequestId ||
        typeof data.ok !== 'boolean'
      ) return;
      if (data.error !== undefined && typeof data.error !== 'string') return;
      if (data.updatedAt !== undefined && typeof data.updatedAt !== 'string') return;

      pendingRequestId = null;
      if (data.ok) {
        reportStatus('saved', 'Compatibility settings saved.');
      } else {
        reportStatus('degraded', truncateText(data.error || 'Compatibility settings were not saved.'));
      }
      if (queuedSettings !== null && !shuttingDown) {
        var nextSettings = queuedSettings;
        queuedSettings = null;
        sendSettingsSnapshot(nextSettings);
      }
    }

    function handleShutdown(data) {
      if (!initialized || shuttingDown || data.sessionId !== sessionId) return;
      if (!hasOnlyKeys(data, ['type', 'protocolVersion', 'sessionId'])) return;
      shuttingDown = true;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      queuedSettings = null;
      reportStatus('shutdown', 'Compatibility runtime shut down.');
    }

    function handleHostMessage(event) {
      if (event.source !== window.parent || !isPlainObject(event.data)) return;
      var data = event.data;
      if (data.protocolVersion !== PROTOCOL_VERSION || typeof data.type !== 'string') return;
      if (data.type === 'roleagent:compat:init') {
        handleInit(data);
        return;
      }
      if (data.type === 'roleagent:compat:save-result') {
        handleSaveResult(data);
        return;
      }
      if (data.type === 'roleagent:compat:shutdown') handleShutdown(data);
    }

    window.addEventListener('message', handleHostMessage);
    postToHost('roleagent:compat:shell-ready', {});
    var initTimeout = window.setTimeout(function () {
      if (!initialized && !shuttingDown) {
        reportStatus('degraded', 'Timed out waiting for host initialization.');
      }
    }, INIT_TIMEOUT_MS);
  }());
  </script>
</body>
</html>`;
}

export async function getExtensionCompatRuntime(
  extensionId: string,
): Promise<ExtensionCompatRuntimeDocument> {
  const extension = await prisma.installedExtension.findUnique({
    where: { id: extensionId },
    select: {
      id: true,
      enabled: true,
      manifestJson: true,
    },
  });
  if (!extension) return compatError(404, 'Extension not found.');
  if (!extension.enabled) return compatError(403, 'Extension is disabled.');

  const manifest = parseCompatManifest(extension.manifestJson);
  const jsEntry = readManifestAssetEntry(manifest, 'js', true);
  if (jsEntry === null) {
    return compatError(409, 'Extension manifest does not declare a JavaScript entry.');
  }
  const cssEntry = readManifestAssetEntry(manifest, 'css', false);

  const { extensionRoot } = await getInstalledExtensionForAssets(extension.id);
  await resolveExtensionAssetPath(extensionRoot, jsEntry);
  if (cssEntry !== null) await resolveExtensionAssetPath(extensionRoot, cssEntry);

  const nonce = randomBytes(18).toString('base64');
  const html = buildCompatRuntimeHtml(
    extension.id,
    buildExtensionAssetUrl(extension.id, jsEntry),
    cssEntry === null ? null : buildExtensionAssetUrl(extension.id, cssEntry),
    nonce,
  );
  return {
    html,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': buildCompatRuntimeCsp(nonce),
      'Referrer-Policy': 'no-referrer',
    },
  };
}
