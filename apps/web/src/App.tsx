import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { appName } from '@roleagent/shared';
import type { HealthResponse, CharacterDto, GenerationSettingsDto } from '@roleagent/shared';
import { fetchCharacters, createCharacter, getGenerationSettings } from './api';
import { CharacterDetail } from './components/CharacterDetail';
import { ChatPanel } from './components/ChatPanel';
import { CharacterImport } from './components/CharacterImport';
import { GenerationControls } from './components/GenerationControls';
import { LlmSettings } from './components/LlmSettings';
import { PromptSettings } from './components/PromptSettings';
import { PromptPresetsPanel } from './components/PromptPresetsPanel';
import { CollapsibleSection } from './components/CollapsibleSection';
import { WorldBookPanel } from './components/WorldBookPanel';
import './App.css';

type ConnectionState = 'checking' | 'connected' | 'error';
type WorkspaceView = 'chat' | 'promptPresets';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatConnectionState(value: ConnectionState): string {
  if (value === 'checking') return '检查中';
  if (value === 'connected') return '已连接';
  return '错误';
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeWorldBookIds, setActiveWorldBookIds] = useState<string[]>([]);
  const [worldBookRefreshKey, setWorldBookRefreshKey] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('chat');
  const [generationSettings, setGenerationSettings] =
    useState<GenerationSettingsDto | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    getGenerationSettings()
      .then((settings) => {
        if (!cancelled) setGenerationSettings(settings);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('名称不能为空');
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
      setWorkspaceView('chat');
      setDetailOpen(false);
      setConversationId(null);
      setActiveWorldBookIds([]);
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
    setWorkspaceView('chat');
    setDetailOpen(false);
    setConversationId(null);
    setActiveWorldBookIds([]);
    setWorldBookRefreshKey((prev) => prev + 1);
  };

  const handleDeleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setSelectedId(null);
    setDetailOpen(false);
    setConversationId(null);
    setActiveWorldBookIds([]);
  };

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  const handleConversationReady = useCallback(
    (nextConversationId: string, nextActiveWorldBookIds: string[]) => {
      setConversationId(nextConversationId);
      setActiveWorldBookIds(nextActiveWorldBookIds);
    },
    [],
  );

  return (
    <main className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar" aria-label="角色控制">
        <header className="brand-panel">
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? '展开' : '隐藏'}
          </button>
          {!sidebarCollapsed && (
            <div>
              <p className="eyebrow">本地工作区</p>
              <h1>{appName}</h1>
            </div>
          )}
          <div className={`status-card status-card--${state}`}>
            <span className="status-dot" aria-hidden="true" />
            {!sidebarCollapsed && (
              <div>
                <span className="status-label">后端</span>
                <strong>{formatConnectionState(state)}</strong>
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
              title="角色"
              eyebrow="角色列表"
              badge={<span className="count-pill">{characters.length}</span>}
              defaultOpen
            >
              <section className="character-list-panel">
              {loading && <p className="empty-state">正在加载角色...</p>}
              {listError !== null && (
                <p className="notice notice--error">角色列表加载失败：{listError}</p>
              )}
              {!loading && listError === null && characters.length === 0 && (
                <p className="empty-state">
                  暂无角色。可以创建角色或导入角色卡开始。
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
                          setWorkspaceView('chat');
                          setDetailOpen(false);
                          setConversationId(null);
                          setActiveWorldBookIds([]);
                        }}
                        aria-pressed={selectedCharacter}
                      >
                        <span className="character-list-name">{c.name}</span>
                        <span className="character-list-description">
                          {c.description ?? '暂无简介'}
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
              title="模型设置"
              eyebrow="API"
              defaultOpen={false}
            >
              <LlmSettings />
            </CollapsibleSection>

            <CollapsibleSection
              title="Prompt 设置"
              eyebrow="生成"
              defaultOpen={false}
            >
              <PromptSettings />
            </CollapsibleSection>

            <CollapsibleSection
              title="Generation Controls"
              eyebrow="LLM"
              defaultOpen={false}
            >
              <GenerationControls
                settings={generationSettings}
                onSettingsChange={setGenerationSettings}
              />
            </CollapsibleSection>

            <button
              className={`workspace-nav-button${
                workspaceView === 'promptPresets' ? ' workspace-nav-button--active' : ''
              }`}
              type="button"
              onClick={() => setWorkspaceView('promptPresets')}
            >
              <span>Prompt Presets</span>
              <small>Structured prompt library</small>
            </button>

            <CollapsibleSection
              title="世界书"
              eyebrow="上下文"
              badge={<span className="count-pill">{activeWorldBookIds.length}</span>}
            >
              <WorldBookPanel
                character={selected}
                conversationId={conversationId}
                activeWorldBookIds={activeWorldBookIds}
                refreshKey={worldBookRefreshKey}
                onConversationReady={handleConversationReady}
                onActiveWorldBooksChange={setActiveWorldBookIds}
              />
            </CollapsibleSection>

            <CollapsibleSection title="创建角色" eyebrow="快速开始">
              <form className="stacked-form" onSubmit={handleCreate}>
                <label className="field">
                  <span>名称</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    placeholder="酒馆里的新角色"
                  />
                </label>
                <label className="field">
                  <span>简介</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={submitting}
                    placeholder="这个角色有什么特点？"
                    rows={3}
                  />
                </label>
                <button className="button button--primary" type="submit" disabled={submitting}>
                  {submitting ? '创建中...' : '创建角色'}
                </button>
                {formError !== null && <p className="notice notice--error">{formError}</p>}
              </form>
            </CollapsibleSection>

            <CollapsibleSection title="导入角色" eyebrow="角色卡">
              <CharacterImport onImported={handleImported} />
            </CollapsibleSection>
          </>
        )}
      </aside>

      <section className="app-workspace" aria-label="Character workspace">
        {workspaceView === 'promptPresets' ? (
          <PromptPresetsPanel />
        ) : selected !== null ? (
          <ChatPanel
            key={`chat-${selected.id}`}
            character={selected}
            detailOpen={detailOpen}
            onToggleDetail={() => setDetailOpen((prev) => !prev)}
            activeWorldBookCount={activeWorldBookIds.length}
            onConversationReady={handleConversationReady}
            streamEnabled={generationSettings?.streamEnabled ?? true}
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
            <p className="eyebrow">准备就绪</p>
            <h2>选择一个角色</h2>
            <p>
              从左侧选择角色，或创建/导入角色卡，然后开始聊天。
            </p>
          </section>
        )}
      </section>
    </main>
  );
}
