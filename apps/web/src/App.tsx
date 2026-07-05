import { useEffect, useState, type FormEvent } from 'react';
import { appName } from '@roleagent/shared';
import type { HealthResponse, CharacterDto } from '@roleagent/shared';
import { fetchCharacters, createCharacter } from './api';
import { CharacterDetail } from './components/CharacterDetail';
import { ChatPanel } from './components/ChatPanel';
import { CharacterImport } from './components/CharacterImport';
import { LlmSettings } from './components/LlmSettings';
import { CollapsibleSection } from './components/CollapsibleSection';
import './App.css';

type ConnectionState = 'checking' | 'connected' | 'error';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

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
      setSelectedId(created.id);
      setDetailOpen(false);
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

  const handleImported = (created: CharacterDto) => {
    setCharacters((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setDetailOpen(false);
  };

  const handleDeleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setSelectedId(null);
    setDetailOpen(false);
  };

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  return (
    <main className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar" aria-label="Character controls">
        <header className="brand-panel">
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? 'Open' : 'Hide'}
          </button>
          {!sidebarCollapsed && (
            <div>
              <p className="eyebrow">Local workspace</p>
              <h1>{appName}</h1>
            </div>
          )}
          <div className={`status-card status-card--${state}`}>
            <span className="status-dot" aria-hidden="true" />
            {!sidebarCollapsed && (
              <div>
                <span className="status-label">Backend</span>
                <strong>{state}</strong>
                {backendName !== null && <small>{backendName}</small>}
                {state === 'error' && error !== null && <small>{error}</small>}
              </div>
            )}
          </div>
        </header>

        {sidebarCollapsed ? (
          <div className="sidebar-rail" aria-label="Collapsed sidebar summary">
            <span className="rail-mark">RT</span>
            <span className="rail-count">{characters.length}</span>
          </div>
        ) : (
          <>
            <CollapsibleSection
              title="Characters"
              eyebrow="Cast"
              badge={<span className="count-pill">{characters.length}</span>}
              defaultOpen
            >
              <section className="character-list-panel">
              {loading && <p className="empty-state">Loading characters...</p>}
              {listError !== null && (
                <p className="notice notice--error">Failed to load list: {listError}</p>
              )}
              {!loading && listError === null && characters.length === 0 && (
                <p className="empty-state">
                  No characters yet. Create one or import a card to begin.
                </p>
              )}
              {characters.length > 0 && (
                <div className="character-list" role="list">
                  {characters.map((c) => {
                    const selectedCharacter = c.id === selectedId;
                    return (
                      <button
                        className={`character-list-item${
                          selectedCharacter ? ' character-list-item--selected' : ''
                        }`}
                        type="button"
                        key={c.id}
                        onClick={() => {
                          setSelectedId(c.id);
                          setDetailOpen(false);
                        }}
                        aria-pressed={selectedCharacter}
                      >
                        <span className="character-list-name">{c.name}</span>
                        <span className="character-list-description">
                          {c.description ?? 'No description yet'}
                        </span>
                        <span className="character-list-date">{formatDate(c.createdAt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              </section>
            </CollapsibleSection>

            <CollapsibleSection
              title="LLM Settings"
              eyebrow="API"
              defaultOpen={false}
            >
              <LlmSettings />
            </CollapsibleSection>

            <CollapsibleSection title="Create Character" eyebrow="Quick start">
              <form className="stacked-form" onSubmit={handleCreate}>
                <label className="field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    placeholder="A tavern regular"
                  />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={submitting}
                    placeholder="What should others know about them?"
                    rows={3}
                  />
                </label>
                <button className="button button--primary" type="submit" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create character'}
                </button>
                {formError !== null && <p className="notice notice--error">{formError}</p>}
              </form>
            </CollapsibleSection>

            <CollapsibleSection title="Import Character" eyebrow="Card import">
              <CharacterImport onImported={handleImported} />
            </CollapsibleSection>
          </>
        )}
      </aside>

      <section className="app-workspace" aria-label="Character workspace">
        {selected !== null ? (
          <ChatPanel
            key={`chat-${selected.id}`}
            character={selected}
            detailOpen={detailOpen}
            onToggleDetail={() => setDetailOpen((prev) => !prev)}
            detailSlot={
              <CharacterDetail
                key={selected.id}
                character={selected}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            }
          />
        ) : (
          <section className="workspace-empty">
            <p className="eyebrow">Ready when you are</p>
            <h2>Select a character</h2>
            <p>
              Choose someone from the left, create a new character, or import a character card
              to open their details and start chatting.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}
