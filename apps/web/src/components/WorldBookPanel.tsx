import { useEffect, useState, type ChangeEvent } from 'react';
import type { CharacterDto, WorldBookDto } from '@roleagent/shared';
import {
  deleteWorldBook,
  exportWorldBook,
  fetchWorldBooks,
  getCharacterConversation,
  importWorldBook,
  updateConversationWorldBooks,
} from '../api';

interface WorldBookPanelProps {
  character: CharacterDto | null;
  conversationId: string | null;
  activeWorldBookIds: string[];
  refreshKey: number;
  onConversationReady: (conversationId: string, activeWorldBookIds: string[]) => void;
  onActiveWorldBooksChange: (ids: string[]) => void;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function WorldBookPanel({
  character,
  conversationId,
  activeWorldBookIds,
  refreshKey,
  onConversationReady,
  onActiveWorldBooksChange,
}: WorldBookPanelProps) {
  const [worldBooks, setWorldBooks] = useState<WorldBookDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadWorldBooks = () => {
    setLoading(true);
    fetchWorldBooks()
      .then((list) => {
        setWorldBooks(list);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWorldBooks();
  }, [refreshKey]);

  const ensureConversation = async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!character) return null;
    const res = await getCharacterConversation(character.id);
    onConversationReady(res.conversation.id, res.activeWorldBookIds);
    return res.conversation.id;
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!character) return;
    setUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      const idToUse = await ensureConversation();
      if (!idToUse) return;
      const nextIds = enabled
        ? [...new Set([...activeWorldBookIds, id])]
        : activeWorldBookIds.filter((item) => item !== id);
      const res = await updateConversationWorldBooks(idToUse, {
        worldBookIds: nextIds,
      });
      onActiveWorldBooksChange(res.activeWorldBookIds);
      onConversationReady(res.conversation.id, res.activeWorldBookIds);
      setSuccess('当前启用世界书已更新。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      const rawJson = JSON.parse(await file.text()) as unknown;
      const created = await importWorldBook({ rawJson });
      setSuccess(`已导入世界书：${created.name}`);
      loadWorldBooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
      e.target.value = '';
    }
  };

  const handleExport = async (worldBook: WorldBookDto) => {
    setError(null);
    try {
      const data = await exportWorldBook(worldBook.id);
      downloadJson(`${worldBook.name || 'worldbook'}.json`, data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (worldBook: WorldBookDto) => {
    if (!window.confirm(`确定删除世界书“${worldBook.name}”？`)) return;
    setUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteWorldBook(worldBook.id);
      if (activeWorldBookIds.includes(worldBook.id)) {
        onActiveWorldBooksChange(
          activeWorldBookIds.filter((id) => id !== worldBook.id),
        );
      }
      setSuccess('世界书已删除。');
      loadWorldBooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section className="worldbook-panel">
      <label className={`import-dropzone${updating ? ' import-dropzone--busy' : ''}`}>
        <input
          type="file"
          accept=".json"
          disabled={updating}
          onChange={handleImport}
        />
        <span>{updating ? '处理中...' : '导入世界书 JSON'}</span>
        <small>支持普通 JSON 或 SillyTavern character_book。</small>
      </label>

      {!character && <p className="empty-state">选择角色后可设置当前启用世界书。</p>}
      {loading && <p className="empty-state">正在加载世界书...</p>}
      {!loading && worldBooks.length === 0 && (
        <p className="empty-state">暂无世界书。可以先导入 JSON。</p>
      )}
      {worldBooks.length > 0 && (
        <div className="worldbook-list">
          {worldBooks.map((worldBook) => {
            const checked = activeWorldBookIds.includes(worldBook.id);
            return (
              <article className="worldbook-item" key={worldBook.id}>
                <label className="worldbook-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!character || updating}
                    onChange={(e) => handleToggle(worldBook.id, e.target.checked)}
                  />
                  <span>
                    <strong>{worldBook.name}</strong>
                    <small>{worldBook.description ?? '暂无描述'}</small>
                  </span>
                </label>
                <div className="worldbook-actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => handleExport(worldBook)}
                  >
                    导出
                  </button>
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={updating}
                    onClick={() => handleDelete(worldBook)}
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {success !== null && <p className="notice notice--success">{success}</p>}
      {error !== null && <p className="notice notice--error">{error}</p>}
    </section>
  );
}
