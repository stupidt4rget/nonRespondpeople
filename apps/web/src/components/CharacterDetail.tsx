import { useState, type FormEvent } from 'react';
import type { CharacterDto } from '@roleagent/shared';
import { updateCharacter, deleteCharacter } from '../api';

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
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setError('name must not be empty');
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
    if (!window.confirm(`Delete character "${character.name}"?`)) {
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

  return (
    <section className="workspace-panel character-detail-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Character detail</p>
          <h2>{character.name}</h2>
          <p className="panel-subtitle">
            {character.description ?? 'No description has been written yet.'}
          </p>
        </div>
        <div className="meta-stack">
          <span>Created {formatDate(character.createdAt)}</span>
          <span>Updated {formatDate(character.updatedAt)}</span>
        </div>
      </header>

      <div className="detail-grid">
        <section className="detail-card">
          <h3>Persona</h3>
          <p>{character.persona ?? 'No persona notes yet.'}</p>
        </section>
        <section className="detail-card">
          <h3>Scenario</h3>
          <p>{character.scenario ?? 'No scenario has been set.'}</p>
        </section>
        <section className="detail-card">
          <h3>First message</h3>
          <p>{character.firstMessage ?? 'No opening message configured.'}</p>
        </section>
        <section className="detail-card">
          <h3>System prompt</h3>
          <p>{character.systemPrompt ?? 'No system prompt configured.'}</p>
        </section>
      </div>

      <form className="edit-panel" onSubmit={handleSave}>
        <div className="section-heading">
          <p className="eyebrow">Manage</p>
          <h3>Edit character</h3>
        </div>
        <div className="edit-grid">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={editing || deleting}
            />
          </label>
          <label className="field">
            <span>Description</span>
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
            {editing ? 'Saving...' : 'Save changes'}
          </button>
          <button
            className="button button--danger"
            type="button"
            onClick={handleDelete}
            disabled={editing || deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
