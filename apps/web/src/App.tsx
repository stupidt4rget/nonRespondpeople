import { useEffect, useState, type FormEvent } from 'react';
import { appName } from '@roleagent/shared';
import type { HealthResponse, CharacterDto } from '@roleagent/shared';
import { fetchCharacters, createCharacter } from './api';

type ConnectionState = 'checking' | 'connected' | 'error';

export function App() {
  const [state, setState] = useState<ConnectionState>('checking');
  const [backendName, setBackendName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCharacters()
      .then((list) => {
        if (cancelled) return;
        setCharacters(list);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('name 不能为空');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createCharacter({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setCharacters((prev) => [created, ...prev]);
      setName('');
      setDescription('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <h1>{appName}</h1>
      <p>后端连接状态：{state}</p>
      {backendName !== null && <p>后端名称：{backendName}</p>}
      {state === 'error' && error !== null && <p>错误：{error}</p>}

      <hr />

      <section>
        <h2>Character 列表</h2>
        {loading && <p>加载中…</p>}
        {listError !== null && <p>列表加载失败：{listError}</p>}
        {!loading && listError === null && characters.length === 0 && (
          <p>暂无角色</p>
        )}
        {characters.length > 0 && (
          <ul>
            {characters.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> — {c.description ?? '无描述'} —{' '}
                {c.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>

      <hr />

      <section>
        <h2>创建 Character</h2>
        <form onSubmit={handleCreate}>
          <div>
            <label>
              name：
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
              />
            </label>
          </div>
          <div>
            <label>
              description：
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </label>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </button>
          {formError !== null && <p style={{ color: 'red' }}>{formError}</p>}
        </form>
      </section>
    </main>
  );
}
