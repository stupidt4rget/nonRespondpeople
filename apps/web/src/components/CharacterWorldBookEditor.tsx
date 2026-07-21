import { useEffect, useState } from 'react';
import type {
  CharacterDto,
  WorldBookDto,
  WorldBookEntryDto,
} from '@roleagent/shared';
import {
  createCharacterWorldBook,
  fetchCharacterWorldBooks,
  updateWorldBook,
} from '../api';

interface CharacterWorldBookEditorProps {
  character: CharacterDto;
}

const INSERTION_POSITION_LABELS: Record<
  WorldBookEntryDto['insertionPosition'],
  string
> = {
  beforeCharacter: '角色设定前',
  afterCharacter: '角色设定后',
  beforeRecentMessages: '最近消息前',
  afterRecentMessages: '最近消息后',
};

const TRIGGER_STRATEGY_LABELS: Record<
  WorldBookEntryDto['triggerStrategy'],
  string
> = {
  constant: '始终触发',
  keyword: '关键词',
  selective: '组合关键词',
};

function makeEntry(): WorldBookEntryDto {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `entry-${suffix}`,
    enabled: true,
    title: '新条目',
    comment: null,
    content: '',
    primaryKeys: [],
    secondaryKeys: [],
    triggerStrategy: 'keyword',
    insertionPosition: 'afterCharacter',
    order: 0,
    depth: 4,
    probability: 100,
  };
}

function parseKeys(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n\r，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function safeInteger(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function entryKey(worldBookId: string, entry: WorldBookEntryDto, index: number) {
  return `${worldBookId}:${entry.id}:${index}`;
}

export function CharacterWorldBookEditor({
  character,
}: CharacterWorldBookEditorProps) {
  const [worldBooks, setWorldBooks] = useState<WorldBookDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setWorldBooks([]);
    setDirtyIds(new Set());
    setExpandedEntries(new Set());
    fetchCharacterWorldBooks(character.id)
      .then((response) => {
        if (!cancelled) setWorldBooks(response.worldBooks);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  const markDirty = (worldBookId: string) => {
    setDirtyIds((current) => new Set(current).add(worldBookId));
    setSuccess(null);
  };

  const updateBook = (
    worldBookId: string,
    updater: (worldBook: WorldBookDto) => WorldBookDto,
  ) => {
    setWorldBooks((current) =>
      current.map((worldBook) =>
        worldBook.id === worldBookId ? updater(worldBook) : worldBook,
      ),
    );
    markDirty(worldBookId);
  };

  const updateEntry = (
    worldBookId: string,
    index: number,
    patch: Partial<WorldBookEntryDto>,
  ) => {
    updateBook(worldBookId, (worldBook) => ({
      ...worldBook,
      entries: worldBook.entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createCharacterWorldBook(character.id);
      setWorldBooks([created]);
      setSuccess('角色世界书已创建并绑定，已有会话也已默认启用。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (worldBook: WorldBookDto) => {
    const name = worldBook.name.trim();
    if (!name) {
      setError('世界书名称不能为空。');
      return;
    }
    setSavingId(worldBook.id);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateWorldBook(worldBook.id, {
        name,
        description: worldBook.description?.trim() || null,
        entries: worldBook.entries,
      });
      setWorldBooks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(worldBook.id);
        return next;
      });
      setSuccess(`已保存“${updated.name}”及其 ${updated.entries.length} 条条目。`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleAddEntry = (worldBookId: string) => {
    const entry = makeEntry();
    updateBook(worldBookId, (worldBook) => ({
      ...worldBook,
      entries: [...worldBook.entries, entry],
    }));
    setExpandedEntries((current) => {
      const next = new Set(current);
      const worldBook = worldBooks.find((item) => item.id === worldBookId);
      next.add(entryKey(worldBookId, entry, worldBook?.entries.length ?? 0));
      return next;
    });
  };

  const handleDuplicateEntry = (worldBookId: string, index: number) => {
    updateBook(worldBookId, (worldBook) => {
      const source = worldBook.entries[index];
      if (!source) return worldBook;
      const duplicate = {
        ...source,
        id: makeEntry().id,
        title: `${source.title || '条目'}（副本）`,
        primaryKeys: [...source.primaryKeys],
        secondaryKeys: [...source.secondaryKeys],
      };
      const entries = [...worldBook.entries];
      entries.splice(index + 1, 0, duplicate);
      return { ...worldBook, entries };
    });
  };

  const handleDeleteEntry = (worldBookId: string, index: number) => {
    if (!window.confirm('确定删除这条世界书条目？保存后不可恢复。')) return;
    updateBook(worldBookId, (worldBook) => ({
      ...worldBook,
      entries: worldBook.entries.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const toggleEntryExpanded = (key: string) => {
    setExpandedEntries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <details className="character-worldbook-section">
      <summary className="character-worldbook-summary">
        <span>
          <strong>角色世界书</strong>
          <small>查看、启停和编辑绑定到当前角色的条目</small>
        </span>
        <span className="count-pill">
          {loading ? '加载中' : `${worldBooks.length} 本`}
        </span>
      </summary>

      <div className="character-worldbook-body">
        {loading && <p className="empty-state">正在加载角色世界书...</p>}

        {!loading && worldBooks.length === 0 && (
          <div className="character-worldbook-empty">
            <p>当前角色没有绑定世界书。</p>
            <button
              className="button button--primary"
              type="button"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? '创建中...' : '创建角色世界书'}
            </button>
          </div>
        )}

        {worldBooks.map((worldBook) => {
          const enabledEntries = worldBook.entries.filter(
            (entry) => entry.enabled,
          ).length;
          const saving = savingId === worldBook.id;
          return (
            <section className="character-worldbook-card" key={worldBook.id}>
              <header className="character-worldbook-card-header">
                <div>
                  <p className="eyebrow">角色默认启用</p>
                  <h3>{worldBook.name}</h3>
                  <p>
                    共 {worldBook.entries.length} 条，已启用 {enabledEntries} 条
                  </p>
                </div>
                {dirtyIds.has(worldBook.id) && (
                  <span className="unsaved-pill">有未保存修改</span>
                )}
              </header>

              <div className="character-worldbook-meta-grid">
                <label className="field">
                  <span>世界书名称</span>
                  <input
                    type="text"
                    value={worldBook.name}
                    disabled={saving}
                    onChange={(event) =>
                      updateBook(worldBook.id, (item) => ({
                        ...item,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>描述</span>
                  <input
                    type="text"
                    value={worldBook.description ?? ''}
                    disabled={saving}
                    onChange={(event) =>
                      updateBook(worldBook.id, (item) => ({
                        ...item,
                        description: event.target.value || null,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="character-worldbook-entry-heading">
                <div>
                  <p className="eyebrow">Entries</p>
                  <h4>条目管理</h4>
                </div>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => handleAddEntry(worldBook.id)}
                >
                  新增条目
                </button>
              </div>

              {worldBook.entries.length === 0 ? (
                <p className="empty-state">暂无条目，点击“新增条目”开始编辑。</p>
              ) : (
                <div className="character-worldbook-entry-list">
                  {worldBook.entries.map((entry, index) => {
                    const key = entryKey(worldBook.id, entry, index);
                    const expanded = expandedEntries.has(key);
                    return (
                      <article
                        className={`character-worldbook-entry${
                          entry.enabled ? '' : ' character-worldbook-entry--disabled'
                        }`}
                        key={key}
                      >
                        <div className="character-worldbook-entry-row">
                          <label className="entry-enabled-toggle">
                            <input
                              type="checkbox"
                              checked={entry.enabled}
                              disabled={saving}
                              onChange={(event) =>
                                updateEntry(worldBook.id, index, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            <span>{entry.enabled ? '启用' : '停用'}</span>
                          </label>
                          <div className="character-worldbook-entry-title">
                            <strong>{entry.title || entry.comment || `Entry ${index + 1}`}</strong>
                            {entry.comment && entry.comment !== entry.title && (
                              <small>{entry.comment}</small>
                            )}
                          </div>
                          <div className="character-worldbook-entry-stats">
                            <span>{INSERTION_POSITION_LABELS[entry.insertionPosition]}</span>
                            <span>顺序 {entry.order}</span>
                            <span>深度 {entry.depth ?? '默认'}</span>
                            <span>概率 {entry.probability}%</span>
                          </div>
                          <div className="character-worldbook-entry-actions">
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => toggleEntryExpanded(key)}
                            >
                              {expanded ? '收起' : '编辑'}
                            </button>
                            <button
                              className="button button--secondary"
                              type="button"
                              disabled={saving}
                              onClick={() => handleDuplicateEntry(worldBook.id, index)}
                            >
                              复制
                            </button>
                            <button
                              className="button button--danger"
                              type="button"
                              disabled={saving}
                              onClick={() => handleDeleteEntry(worldBook.id, index)}
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="character-worldbook-entry-editor">
                            <label className="field">
                              <span>标题</span>
                              <input
                                type="text"
                                value={entry.title}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    title: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>备注 / Comment</span>
                              <input
                                type="text"
                                value={entry.comment ?? ''}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    comment: event.target.value || null,
                                  })
                                }
                              />
                            </label>
                            <label className="field character-worldbook-wide-field">
                              <span>内容</span>
                              <textarea
                                rows={5}
                                value={entry.content}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    content: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>主关键词（逗号或换行分隔）</span>
                              <textarea
                                rows={2}
                                value={entry.primaryKeys.join(', ')}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    primaryKeys: parseKeys(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>次关键词（逗号或换行分隔）</span>
                              <textarea
                                rows={2}
                                value={entry.secondaryKeys.join(', ')}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    secondaryKeys: parseKeys(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>触发策略</span>
                              <select
                                value={entry.triggerStrategy}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    triggerStrategy: event.target.value as WorldBookEntryDto['triggerStrategy'],
                                  })
                                }
                              >
                                {Object.entries(TRIGGER_STRATEGY_LABELS).map(
                                  ([value, label]) => (
                                    <option value={value} key={value}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="field">
                              <span>插入位置</span>
                              <select
                                value={entry.insertionPosition}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    insertionPosition: event.target.value as WorldBookEntryDto['insertionPosition'],
                                  })
                                }
                              >
                                {Object.entries(INSERTION_POSITION_LABELS).map(
                                  ([value, label]) => (
                                    <option value={value} key={value}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="field">
                              <span>顺序</span>
                              <input
                                type="number"
                                min={-100000}
                                max={100000}
                                value={entry.order}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    order: safeInteger(event.target.value, entry.order),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>扫描深度（留空使用全局值）</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={entry.depth ?? ''}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    depth:
                                      event.target.value.trim() === ''
                                        ? null
                                        : Math.min(
                                            100,
                                            Math.max(
                                              0,
                                              safeInteger(event.target.value, entry.depth ?? 0),
                                            ),
                                          ),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>触发概率（0–100）</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={entry.probability}
                                disabled={saving}
                                onChange={(event) =>
                                  updateEntry(worldBook.id, index, {
                                    probability: Math.min(
                                      100,
                                      Math.max(
                                        0,
                                        safeInteger(event.target.value, entry.probability),
                                      ),
                                    ),
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="action-row">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={saving || !dirtyIds.has(worldBook.id)}
                  onClick={() => handleSave(worldBook)}
                >
                  {saving ? '保存中...' : '保存世界书条目'}
                </button>
              </div>
            </section>
          );
        })}

        {success !== null && <p className="notice notice--success">{success}</p>}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </div>
    </details>
  );
}
