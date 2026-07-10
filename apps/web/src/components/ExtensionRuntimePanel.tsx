import { useEffect, useRef, useState } from 'react';
import type {
  ExtensionFeatureDto,
  ExtensionSettings,
  InstalledExtensionDto,
} from '@roleagent/shared';
import { getExtensionSettings, updateExtensionSettings } from '../api';

const COMPAT_PROTOCOL_VERSION = 1;
const MAX_COMPAT_MESSAGE_BYTES = 300 * 1024;
const MAX_COMPAT_SETTINGS_BYTES = 256 * 1024;
const MAX_COMPAT_TEXT_LENGTH = 2048;
const MAX_COMPAT_SETTINGS_DEPTH = 32;
const MAX_COMPAT_SETTINGS_NODES = 10_000;
const MAX_COMPAT_STRING_BYTES = 64 * 1024;
const MAX_COMPAT_KEY_CODE_POINTS = 256;
const COMPAT_SHELL_READY_TIMEOUT_MS = 15_000;
const FORBIDDEN_COMPAT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type NativeRuntimeStatus = 'starting' | 'ready';
type ToastLevel = 'info' | 'success' | 'error';
type CompatLogLevel = 'info' | 'warn' | 'error';
type CompatRuntimeStatus =
  | 'loading-settings'
  | 'starting-shell'
  | 'loading-plugin'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'degraded'
  | 'error';

interface RuntimeToast {
  message: string;
  level: ToastLevel;
}

interface CompatLogEntry {
  id: number;
  level: CompatLogLevel;
  message: string;
}

interface RuntimePanelBaseProps {
  extension: InstalledExtensionDto;
  onClose: () => void;
}

interface NativeRuntimePanelProps extends RuntimePanelBaseProps {
  mode: 'native';
  feature: ExtensionFeatureDto;
}

interface CompatRuntimePanelProps extends RuntimePanelBaseProps {
  mode: 'sillytavern-compat';
  feature?: never;
}

type ExtensionRuntimePanelProps = NativeRuntimePanelProps | CompatRuntimePanelProps;

function isMessageObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isMessageObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === allowed.length &&
    keys.every((key) => typeof key === 'string' && allowed.includes(key))
  );
}

function serializedByteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

interface SettingsValidationState {
  nodes: number;
  ancestors: WeakSet<object>;
}

function isCompatJsonValue(
  value: unknown,
  depth: number,
  state: SettingsValidationState,
): boolean {
  state.nodes += 1;
  if (state.nodes > MAX_COMPAT_SETTINGS_NODES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).byteLength <= MAX_COMPAT_STRING_BYTES;
  }
  if (typeof value !== 'object' || depth > MAX_COMPAT_SETTINGS_DEPTH) return false;
  if (state.ancestors.has(value)) return false;

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) return false;
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= value.length) return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
        if (!isCompatJsonValue(descriptor.value, depth + 1, state)) return false;
      }
      return true;
    }

    if (!isPlainObject(value)) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      if ([...key].length > MAX_COMPAT_KEY_CODE_POINTS || FORBIDDEN_COMPAT_KEYS.has(key)) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
      if (!isCompatJsonValue(descriptor.value, depth + 1, state)) return false;
    }
    return true;
  } finally {
    state.ancestors.delete(value);
  }
}

function isExtensionSettings(value: unknown): value is ExtensionSettings {
  try {
    if (!isPlainObject(value)) return false;
    if (!isCompatJsonValue(value, 0, { nodes: 0, ancestors: new WeakSet<object>() })) {
      return false;
    }
    const size = serializedByteLength(value);
    return size !== null && size <= MAX_COMPAT_SETTINGS_BYTES;
  } catch {
    return false;
  }
}

function createCompatSessionId(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_COMPAT_TEXT_LENGTH
    ? message
    : message.slice(0, MAX_COMPAT_TEXT_LENGTH);
}

function formatNativeRuntimeStatus(status: NativeRuntimeStatus): string {
  return status === 'ready' ? '已就绪' : '启动中';
}

function formatCompatRuntimeStatus(status: CompatRuntimeStatus): string {
  const labels: Record<CompatRuntimeStatus, string> = {
    'loading-settings': '正在读取设置',
    'starting-shell': '正在启动兼容环境',
    'loading-plugin': '正在加载插件',
    ready: '已就绪',
    saving: '正在保存',
    saved: '已保存',
    degraded: '降级运行',
    error: '错误',
  };
  return labels[status];
}

function compatStatusFromShell(status: string): CompatRuntimeStatus | null {
  if (status === 'initialized') return 'starting-shell';
  if (status === 'loading-plugin') return 'loading-plugin';
  if (status === 'ready') return 'ready';
  if (status === 'saving') return 'saving';
  if (status === 'saved') return 'saved';
  if (status === 'degraded') return 'degraded';
  if (status === 'error') return 'error';
  return null;
}

function formatToastLevel(level: ToastLevel): string {
  if (level === 'success') return '成功';
  if (level === 'error') return '错误';
  return '提示';
}

function NativeExtensionRuntimePanel({
  extension,
  feature,
  onClose,
}: Omit<NativeRuntimePanelProps, 'mode'>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<NativeRuntimeStatus>('starting');
  const [toast, setToast] = useState<RuntimeToast | null>(null);
  const runtimeUrl = feature.runtimeUrl;

  useEffect(() => {
    setRuntimeStatus('starting');
    setToast(null);
  }, [extension.id, feature.id, runtimeUrl]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !runtimeUrl) return undefined;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (!isMessageObject(event.data)) return;

      let serialized = '';
      try {
        serialized = JSON.stringify(event.data);
      } catch {
        return;
      }
      if (serialized.length > 4096) return;

      const type = event.data.type;
      if (type === 'roleagent:extension-ready') {
        setRuntimeStatus('ready');
        return;
      }

      if (type !== 'roleagent:show-toast') return;

      const message = event.data.message;
      if (typeof message !== 'string' || message.length > 200) return;

      const rawLevel = event.data.level;
      const level: ToastLevel =
        rawLevel === 'success' || rawLevel === 'error' || rawLevel === 'info'
          ? rawLevel
          : 'info';

      setToast({ message, level });
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [runtimeUrl]);

  const handleClose = () => {
    const iframe = iframeRef.current;
    if (iframe) iframe.src = 'about:blank';
    onClose();
  };

  return (
    <section
      className="extension-runtime-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-runtime-title"
    >
      <header className="extension-runtime-header">
        <div>
          <p className="eyebrow">Extension Runtime</p>
          <h3 id="extension-runtime-title">
            {extension.displayName} / {feature.name}
          </h3>
          <p className="extension-runtime-status">
            状态：{formatNativeRuntimeStatus(runtimeStatus)}
          </p>
        </div>
        <button className="button button--secondary" type="button" onClick={handleClose}>
          关闭
        </button>
      </header>

      {toast !== null && (
        <p
          className={`notice extension-runtime-toast extension-runtime-toast--${toast.level}`}
          role="status"
        >
          <span className="extension-runtime-toast-label">{formatToastLevel(toast.level)}</span>
          {toast.message}
        </p>
      )}

      {runtimeUrl ? (
        <iframe
          ref={iframeRef}
          className="extension-runtime-iframe"
          title={`${extension.displayName} - ${feature.name}`}
          sandbox="allow-scripts"
          src={runtimeUrl}
        />
      ) : (
        <p className="notice notice--error">缺少 runtime URL，无法加载扩展运行时。</p>
      )}
    </section>
  );
}

function CompatExtensionRuntimePanel({
  extension,
  onClose,
}: Omit<CompatRuntimePanelProps, 'mode'>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const settingsRef = useRef<ExtensionSettings | null>(null);
  const initSentRef = useRef(false);
  const closedRef = useRef(false);
  const shutdownSentRef = useRef(false);
  const activeSaveRequestIdRef = useRef<string | null>(null);
  const logSequenceRef = useRef(0);
  const logWindowStartedAtRef = useRef(0);
  const logCountRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<CompatRuntimeStatus>('loading-settings');
  const [statusMessage, setStatusMessage] = useState('正在读取扩展兼容设置。');
  const [logs, setLogs] = useState<CompatLogEntry[]>([]);
  const runtimeUrl = extension.compatRuntimeUrl;

  const postToIframe = (message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  };

  const postSaveResult = (
    requestId: string,
    ok: boolean,
    detail?: { error?: string; updatedAt?: string },
  ) => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId || closedRef.current) return;
    postToIframe({
      type: 'roleagent:compat:save-result',
      protocolVersion: COMPAT_PROTOCOL_VERSION,
      sessionId: activeSessionId,
      requestId,
      ok,
      ...(detail?.error ? { error: detail.error } : {}),
      ...(detail?.updatedAt ? { updatedAt: detail.updatedAt } : {}),
    });
  };

  useEffect(() => {
    closedRef.current = false;
    shutdownSentRef.current = false;
    initSentRef.current = false;
    activeSaveRequestIdRef.current = null;
    logWindowStartedAtRef.current = Date.now();
    logCountRef.current = 0;
    sessionIdRef.current = null;
    settingsRef.current = null;
    setSessionId(null);
    setRuntimeStatus('loading-settings');
    setStatusMessage('正在读取扩展兼容设置。');
    setLogs([]);

    let cancelled = false;
    void getExtensionSettings(extension.id)
      .then((response) => {
        if (cancelled || closedRef.current) return;
        if (response.extensionId !== extension.id || !isExtensionSettings(response.settings)) {
          throw new Error('服务器返回了无效的扩展设置。');
        }
        if (!runtimeUrl) throw new Error('缺少 compatibility runtime URL。');
        const nextSessionId = createCompatSessionId();
        settingsRef.current = response.settings;
        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setRuntimeStatus('starting-shell');
        setStatusMessage('设置已读取，正在等待兼容 shell。');
      })
      .catch((loadError: unknown) => {
        if (cancelled || closedRef.current) return;
        setRuntimeStatus('error');
        setStatusMessage(`兼容设置读取失败：${errorMessage(loadError)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [extension.id, runtimeUrl]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const timeout = window.setTimeout(() => {
      if (!initSentRef.current && !closedRef.current) {
        setRuntimeStatus('error');
        setStatusMessage('兼容 shell 启动超时，未收到 shell-ready。');
      }
    }, COMPAT_SHELL_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [sessionId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (!isPlainObject(event.data)) return;

      const data = event.data;
      const messageBytes = serializedByteLength(data);
      if (messageBytes === null || messageBytes > MAX_COMPAT_MESSAGE_BYTES) return;
      if (
        data.protocolVersion !== COMPAT_PROTOCOL_VERSION ||
        typeof data.type !== 'string'
      ) return;

      if (data.type === 'roleagent:compat:shell-ready') {
        if (!hasExactFields(data, ['type', 'protocolVersion', 'sessionId'])) return;
        if (data.sessionId !== null || initSentRef.current || closedRef.current) return;
        const activeSessionId = sessionIdRef.current;
        const settings = settingsRef.current;
        if (!activeSessionId || !settings) return;
        initSentRef.current = true;
        postToIframe({
          type: 'roleagent:compat:init',
          protocolVersion: COMPAT_PROTOCOL_VERSION,
          sessionId: activeSessionId,
          extensionId: extension.id,
          settings,
        });
        setRuntimeStatus('starting-shell');
        setStatusMessage('兼容 shell 已连接，正在初始化安全环境。');
        return;
      }

      const activeSessionId = sessionIdRef.current;
      const hasActiveSession = activeSessionId !== null && data.sessionId === activeSessionId;
      const hasPendingSession = data.sessionId === null && !initSentRef.current;

      if (data.type === 'roleagent:compat:runtime-ready') {
        if (!hasActiveSession) return;
        if (!hasExactFields(data, ['type', 'protocolVersion', 'sessionId', 'level'])) return;
        if (data.level !== 'L1' && data.level !== 'L2') return;
        setRuntimeStatus('ready');
        setStatusMessage('兼容运行时已就绪；未支持的 SillyTavern API 仍不可用。');
        return;
      }

      if (data.type === 'roleagent:compat:status') {
        if (!hasActiveSession && !hasPendingSession) return;
        if (!hasExactFields(data, [
          'type',
          'protocolVersion',
          'sessionId',
          'status',
          'message',
        ])) return;
        if (
          typeof data.status !== 'string' ||
          data.status.length > 64 ||
          typeof data.message !== 'string' ||
          data.message.length > MAX_COMPAT_TEXT_LENGTH
        ) return;
        const nextStatus = compatStatusFromShell(data.status);
        if (nextStatus === null) return;
        setRuntimeStatus(nextStatus);
        setStatusMessage(data.message);
        return;
      }

      if (data.type === 'roleagent:compat:log') {
        if (!hasActiveSession && !hasPendingSession) return;
        if (!hasExactFields(data, [
          'type',
          'protocolVersion',
          'sessionId',
          'level',
          'message',
        ])) return;
        if (
          (data.level !== 'info' && data.level !== 'warn' && data.level !== 'error') ||
          typeof data.message !== 'string' ||
          data.message.length > MAX_COMPAT_TEXT_LENGTH
        ) return;
        const now = Date.now();
        if (now - logWindowStartedAtRef.current >= 10_000) {
          logWindowStartedAtRef.current = now;
          logCountRef.current = 0;
        }
        if (logCountRef.current >= 20) return;
        logCountRef.current += 1;
        const level = data.level;
        logSequenceRef.current += 1;
        setLogs((current) => [
          ...current.slice(-7),
          { id: logSequenceRef.current, level, message: data.message as string },
        ]);
        if (level === 'error') console.error('[Extension compat]', data.message);
        else if (level === 'warn') console.warn('[Extension compat]', data.message);
        else console.info('[Extension compat]', data.message);
        return;
      }

      if (data.type !== 'roleagent:compat:save-settings' || !hasActiveSession) return;
      if (!hasExactFields(data, [
        'type',
        'protocolVersion',
        'sessionId',
        'requestId',
        'settings',
      ])) return;
      if (
        typeof data.requestId !== 'string' ||
        data.requestId.length === 0 ||
        data.requestId.length > 200 ||
        !isExtensionSettings(data.settings)
      ) return;

      const requestId = data.requestId;
      if (activeSaveRequestIdRef.current !== null) {
        postSaveResult(requestId, false, { error: 'Another settings save is already in progress.' });
        return;
      }

      activeSaveRequestIdRef.current = requestId;
      setRuntimeStatus('saving');
      setStatusMessage('正在保存兼容设置。');
      void updateExtensionSettings(extension.id, data.settings)
        .then((response) => {
          if (
            closedRef.current ||
            sessionIdRef.current !== activeSessionId ||
            response.extensionId !== extension.id
          ) return;
          postSaveResult(requestId, true, { updatedAt: response.updatedAt });
          setRuntimeStatus('saved');
          setStatusMessage('兼容设置已保存。');
        })
        .catch((saveError: unknown) => {
          if (closedRef.current || sessionIdRef.current !== activeSessionId) return;
          const message = errorMessage(saveError);
          postSaveResult(requestId, false, { error: message });
          setRuntimeStatus('error');
          setStatusMessage(`兼容设置未保存：${message}`);
        })
        .finally(() => {
          if (activeSaveRequestIdRef.current === requestId) {
            activeSaveRequestIdRef.current = null;
          }
        });
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [extension.id]);

  const shutdownRuntime = () => {
    const activeSessionId = sessionIdRef.current;
    const iframe = iframeRef.current;
    if (!shutdownSentRef.current && activeSessionId && iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: 'roleagent:compat:shutdown',
          protocolVersion: COMPAT_PROTOCOL_VERSION,
          sessionId: activeSessionId,
        },
        '*',
      );
      shutdownSentRef.current = true;
    }
    closedRef.current = true;
    sessionIdRef.current = null;
    settingsRef.current = null;
    activeSaveRequestIdRef.current = null;
    if (iframe) iframe.src = 'about:blank';
  };

  useEffect(() => () => shutdownRuntime(), [extension.id]);

  const handleClose = () => {
    shutdownRuntime();
    onClose();
  };

  return (
    <section
      className="extension-runtime-panel extension-runtime-panel--compat"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-compat-runtime-title"
    >
      <header className="extension-runtime-header">
        <div>
          <p className="eyebrow">SillyTavern Compatibility Runtime</p>
          <h3 id="extension-compat-runtime-title">{extension.displayName}</h3>
          <p className="extension-runtime-status">
            状态：{formatCompatRuntimeStatus(runtimeStatus)}
          </p>
        </div>
        <button className="button button--secondary" type="button" onClick={handleClose}>
          关闭
        </button>
      </header>

      <p
        className={`notice extension-compat-status extension-compat-status--${runtimeStatus}`}
        role="status"
      >
        {statusMessage}
      </p>

      {logs.length > 0 && (
        <ul className="extension-compat-logs" aria-label="Compatibility runtime logs">
          {logs.map((entry) => (
            <li key={entry.id} className={`extension-compat-log extension-compat-log--${entry.level}`}>
              <strong>{entry.level.toUpperCase()}</strong>
              <span>{entry.message}</span>
            </li>
          ))}
        </ul>
      )}

      {runtimeUrl && sessionId ? (
        <iframe
          ref={iframeRef}
          className="extension-runtime-iframe"
          title={`${extension.displayName} - SillyTavern compatibility runtime`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={runtimeUrl}
        />
      ) : runtimeStatus !== 'error' ? (
        <p className="empty-state">正在准备 compatibility runtime...</p>
      ) : null}
    </section>
  );
}

export function ExtensionRuntimePanel(props: ExtensionRuntimePanelProps) {
  if (props.mode === 'native') {
    return (
      <NativeExtensionRuntimePanel
        extension={props.extension}
        feature={props.feature}
        onClose={props.onClose}
      />
    );
  }
  return (
    <CompatExtensionRuntimePanel
      extension={props.extension}
      onClose={props.onClose}
    />
  );
}
