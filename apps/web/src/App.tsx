import { useEffect, useState, type FormEvent } from 'react';
import { appName } from '@roleagent/shared';
import type { HealthResponse, CharacterDto } from '@roleagent/shared';
import { fetchCharacters, createCharacter } from './api';
import { CharacterDetail } from './components/CharacterDetail';
import { ChatPanel } from './components/ChatPanel';

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

  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      setFormError('name must not be empty');
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

  const handleUpdated = (updated: CharacterDto) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c)),
    );
  };

  const handleDeleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setSelectedId(null);
  };

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  return (
    <main>
      <h1>{appName}</h1>
      <p>Backend connection: {state}</p>
      {backendName !== null && <p>Backend name: {backendName}</p>}
      {state === 'error' && error !== null && <p>Error: {error}</p>}

      <hr />

      <section>
        <h2>Character List</h2>
        {loading && <p>Loading...</p>}
        {listError !== null && <p>Failed to load list: {listError}</p>}
        {!loading && listError === null && characters.length === 0 && (
          <p>No characters yet</p>
        )}
        {characters.length > 0 && (
          <ul>
            {characters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    fontWeight: c.id === selectedId ? 'bold' : 'normal',
                  }}
                >
                  {c.name}
                </button>{' '}
                - {c.description ?? 'no description'} - {c.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>

      <hr />

      <section>
        <h2>Create Character</h2>
        <form onSubmit={handleCreate}>
          <div>
            <label>
              name:
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
              description:
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </label>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create'}
          </button>
          {formError !== null && <p style={{ color: 'red' }}>{formError}</p>}
        </form>
      </section>

      <hr />

      {selected !== null ? (
        <>
          <CharacterDetail
            key={selected.id}
            character={selected}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
          <hr />
          <ChatPanel key={`chat-${selected.id}`} character={selected} />
        </>
      ) : (
        <section>
          <h2>Character Detail</h2>
          <p>Select a character to view details.</p>
        </section>
      )}
    </main>
  );
}
