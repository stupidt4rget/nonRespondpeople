import { useEffect, useState } from 'react';
import { appName } from '@roleagent/shared';
import type { HealthResponse } from '@roleagent/shared';

type ConnectionState = 'checking' | 'connected' | 'error';

export function App() {
  const [state, setState] = useState<ConnectionState>('checking');
  const [backendName, setBackendName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('checking');
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        setBackendName(data.name);
        setState('connected');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>{appName}</h1>
      <p>后端连接状态：{state}</p>
      {backendName !== null && <p>后端名称：{backendName}</p>}
      {state === 'error' && error !== null && <p>错误：{error}</p>}
    </main>
  );
}
