import { useState, type FormEvent } from 'react';
import type { CharacterDto } from '@roleagent/shared';
import { updateCharacter, deleteCharacter } from '../api';

interface CharacterDetailProps {
  character: CharacterDto;
  onUpdated: (updated: CharacterDto) => void;
  onDeleted: (id: string) => void;
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
    <section>
      <h2>Character Detail</h2>
      <dl>
        <dt>id</dt>
        <dd>{character.id}</dd>
        <dt>name</dt>
        <dd>{character.name}</dd>
        <dt>description</dt>
        <dd>{character.description ?? 'no description'}</dd>
        <dt>createdAt</dt>
        <dd>{character.createdAt}</dd>
        <dt>updatedAt</dt>
        <dd>{character.updatedAt}</dd>
      </dl>

      <h3>Edit</h3>
      <form onSubmit={handleSave}>
        <div>
          <label>
            name:
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={editing || deleting}
            />
          </label>
        </div>
        <div>
          <label>
            description:
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={editing || deleting}
            />
          </label>
        </div>
        <button type="submit" disabled={editing || deleting}>
          {editing ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={editing || deleting}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
        {error !== null && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </section>
  );
}
