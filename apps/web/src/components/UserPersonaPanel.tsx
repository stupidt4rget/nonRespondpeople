import { useState, type FormEvent } from 'react';
import type { UserPersonaDto } from '@roleagent/shared';
import {
  createUserPersona,
  deleteUserPersona,
  updateUserPersona,
} from '../api';

interface UserPersonaPanelProps {
  personas: UserPersonaDto[];
  loading: boolean;
  onPersonasChange: (personas: UserPersonaDto[]) => void;
  onRefresh: () => Promise<void>;
}

export function UserPersonaPanel({
  personas,
  loading,
  onPersonasChange,
  onRefresh,
}: UserPersonaPanelProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const startEdit = (persona: UserPersonaDto) => {
    setEditingId(persona.id);
    setEditName(persona.name);
    setEditDescription(persona.description);
    setEditEnabled(persona.enabled);
    setError(null);
    setSuccess(null);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !description.trim()) {
      setError('名称和设定内容不能为空。');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createUserPersona({
        name: name.trim(),
        description: description.trim(),
        enabled: true,
      });
      onPersonasChange([created, ...personas]);
      setName('');
      setDescription('');
      setSuccess('用户设定已创建。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (id: string) => {
    if (!editName.trim() || !editDescription.trim()) {
      setError('名称和设定内容不能为空。');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateUserPersona(id, {
        name: editName.trim(),
        description: editDescription.trim(),
        enabled: editEnabled,
      });
      onPersonasChange(
        personas.map((persona) => (persona.id === updated.id ? updated : persona)),
      );
      setEditingId(null);
      setSuccess('用户设定已保存。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (persona: UserPersonaDto) => {
    if (!window.confirm(`删除用户设定“${persona.name}”？相关对话绑定会被清空。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await deleteUserPersona(persona.id);
      onPersonasChange(personas.filter((item) => item.id !== persona.id));
      setSuccess(`已删除，清空 ${res.clearedConversationCount} 个对话绑定。`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="persona-panel">
      <form className="stacked-form" onSubmit={handleCreate}>
        <label className="field">
          <span>名称</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            placeholder="例如：默认玩家"
          />
        </label>
        <label className="field">
          <span>用户设定</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            rows={4}
            placeholder="写下你希望模型知道的用户身份、口吻或背景。"
          />
        </label>
        <button className="button button--primary" type="submit" disabled={busy}>
          创建用户设定
        </button>
      </form>

      <div className="persona-list">
        {loading && <p className="empty-state">正在加载用户设定...</p>}
        {!loading && personas.length === 0 && (
          <p className="empty-state">暂无用户设定。创建后可在当前对话中绑定。</p>
        )}
        {personas.map((persona) => (
          <article className="persona-item" key={persona.id}>
            {editingId === persona.id ? (
              <div className="stacked-form">
                <label className="field">
                  <span>名称</span>
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>用户设定</span>
                  <textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    disabled={busy}
                    rows={4}
                  />
                </label>
                <label className="field field--checkbox">
                  <input
                    type="checkbox"
                    checked={editEnabled}
                    onChange={(event) => setEditEnabled(event.target.checked)}
                    disabled={busy}
                  />
                  <span>启用</span>
                </label>
                <div className="action-row">
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSave(persona.id)}
                  >
                    保存
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="persona-item-header">
                  <strong>{persona.name}</strong>
                  <span className="active-badge">{persona.enabled ? '启用' : '禁用'}</span>
                </div>
                <p>{persona.description}</p>
                <div className="worldbook-actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(persona)}
                  >
                    编辑
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void updateUserPersona(persona.id, {
                        enabled: !persona.enabled,
                      }).then(async () => {
                        await onRefresh();
                      })
                    }
                  >
                    {persona.enabled ? '禁用' : '启用'}
                  </button>
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDelete(persona)}
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {success !== null && <p className="notice notice--success">{success}</p>}
      {error !== null && <p className="notice notice--error">{error}</p>}
    </section>
  );
}
