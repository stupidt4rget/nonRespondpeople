import { useState, type FormEvent } from 'react';
import type { CharacterDto } from '@roleagent/shared';
import { updateCharacter, deleteCharacter, exportCharacterCard } from '../api';
import { CharacterWorldBookEditor } from './CharacterWorldBookEditor';

interface CharacterDetailProps {
  character: CharacterDto;
  onUpdated: (updated: CharacterDto) => void;
  onDeleted: (id: string) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function CharacterDetail({
  character,
  onUpdated,
  onDeleted,
}: CharacterDetailProps) {
  const [editName, setEditName] = useState(character.name);
  const [editDescription, setEditDescription] = useState(
    character.description ?? '',
  );
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setError('名称不能为空');
      return;
    }
    setError(null);
    setEditing(true);
    try {
      const updated = await updateCharacter(character.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      onUpdated(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定删除角色“${character.name}”？`)) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await deleteCharacter(character.id);
      onDeleted(character.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const data = await exportCharacterCard(character.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${character.name || 'character'}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="character-detail-panel">
      <header className="detail-drawer-header">
        <div>
          <p className="eyebrow">角色详情</p>
          <h2>{character.name}</h2>
          <p className="panel-subtitle">
            {character.description ?? '暂无角色简介。'}
          </p>
        </div>
        <div className="meta-stack">
          <span>创建于 {formatDate(character.createdAt)}</span>
          <span>更新于 {formatDate(character.updatedAt)}</span>
        </div>
      </header>

      <form className="edit-panel" onSubmit={handleSave}>
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">管理</p>
            <h3>编辑角色</h3>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={handleExport}
            disabled={exporting || editing || deleting}
          >
            {exporting ? '导出中...' : '导出角色'}
          </button>
          <button
            className="button button--danger"
            type="button"
            onClick={handleDelete}
            disabled={editing || deleting}
          >
            {deleting ? '删除中...' : '删除角色'}
          </button>
        </div>
        <div className="edit-grid">
          <label className="field">
            <span>名称</span>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={editing || deleting}
            />
          </label>
          <label className="field">
            <span>简介</span>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={editing || deleting}
              rows={3}
            />
          </label>
        </div>
        <div className="action-row">
          <button className="button button--primary" type="submit" disabled={editing || deleting}>
            {editing ? '保存中...' : '保存修改'}
          </button>
        </div>
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>

      <CharacterWorldBookEditor character={character} />

      <div className={`detail-grid${textExpanded ? ' detail-grid--expanded' : ''}`}>
        <section className="detail-card">
          <h3>人格</h3>
          <p className="detail-text">
            {character.personality ?? character.persona ?? '暂无人格设定。'}
          </p>
        </section>
        <section className="detail-card">
          <h3>场景</h3>
          <p className="detail-text">{character.scenario ?? '暂无场景设定。'}</p>
        </section>
        <section className="detail-card">
          <h3>开场白</h3>
          <p className="detail-text">
            {character.firstMessage ?? '暂无开场白。'}
          </p>
        </section>
        <section className="detail-card">
          <h3>系统提示</h3>
          <p className="detail-text">
            {character.systemPrompt ?? '暂无系统提示。'}
          </p>
        </section>
        <section className="detail-card">
          <h3>后置指令</h3>
          <p className="detail-text">
            {character.postHistoryInstructions ?? '暂无后置指令。'}
          </p>
        </section>
      </div>

      <div className="detail-actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setTextExpanded((prev) => !prev)}
        >
          {textExpanded ? '收起' : '展开更多'}
        </button>
      </div>
    </section>
  );
}
