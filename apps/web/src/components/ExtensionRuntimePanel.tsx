import { useEffect, useRef, useState } from 'react';
import type { ExtensionFeatureDto, InstalledExtensionDto } from '@roleagent/shared';

type RuntimeStatus = 'starting' | 'ready';
type ToastLevel = 'info' | 'success' | 'error';

interface RuntimeToast {
  message: string;
  level: ToastLevel;
}

interface ExtensionRuntimePanelProps {
  extension: InstalledExtensionDto;
  feature: ExtensionFeatureDto;
  onClose: () => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatRuntimeStatus(status: RuntimeStatus): string {
  return status === 'ready' ? '已就绪' : '启动中';
}

function formatToastLevel(level: ToastLevel): string {
  if (level === 'success') return '成功';
  if (level === 'error') return '错误';
  return '提示';
}

export function ExtensionRuntimePanel({
  extension,
  feature,
  onClose,
}: ExtensionRuntimePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>('starting');
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
      if (!isPlainObject(event.data)) return;

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
    if (iframe) {
      iframe.src = 'about:blank';
    }
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
            状态：{formatRuntimeStatus(runtimeStatus)}
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
