import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type {
  PromptPresetDto,
  PromptPresetEntryDto,
  PromptPresetImportPreviewResponse,
} from '@roleagent/shared';
import {
  activatePromptPreset,
  applyPromptPresetImport,
  createPromptPreset,
  deletePromptPreset,
  duplicatePromptPreset,
  exportPromptPreset,
  fetchPromptPreset,
  fetchPromptPresets,
  previewPromptPresetImport,
  updatePromptPreset,
  updatePromptPresetEntries,
} from '../api';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function clip(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

function sortEntries(entries: PromptPresetEntryDto[]): PromptPresetEntryDto[] {
  return [...entries].sort((a, b) => a.orderIndex - b.orderIndex);
}

export function PromptPresetsPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [presets, setPresets] = useState<PromptPresetDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PromptPresetDto | null>(null);
  const [entriesDraft, setEntriesDraft] = useState<PromptPresetEntryDto[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [importPreview, setImportPreview] =
    useState<PromptPresetImportPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activePresetId = useMemo(
    () => presets.find((preset) => preset.isActive)?.id ?? null,
    [presets],
  );

  const loadPresets = async (nextSelectedId = selectedId) => {
    const list = await fetchPromptPresets();
    setPresets(list);
    const id = nextSelectedId ?? list[0]?.id ?? null;
    setSelectedId(id);
    if (id) {
      const detail = await fetchPromptPreset(id);
      setSelected(detail);
      setNameDraft(detail.name);
      setEntriesDraft(sortEntries(detail.entries ?? []));
    } else {
      setSelected(null);
      setNameDraft('');
      setEntriesDraft([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPromptPresets()
      .then(async (list) => {
        if (cancelled) return;
        setPresets(list);
        const id = list[0]?.id ?? null;
        setSelectedId(id);
        if (id) {
          const detail = await fetchPromptPreset(id);
          if (cancelled) return;
          setSelected(detail);
          setNameDraft(detail.name);
          setEntriesDraft(sortEntries(detail.entries ?? []));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (task: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await task();
      setSuccess(ok);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectPreset = async (id: string) => {
    await run(async () => {
      const detail = await fetchPromptPreset(id);
      setSelectedId(id);
      setSelected(detail);
      setNameDraft(detail.name);
      setEntriesDraft(sortEntries(detail.entries ?? []));
    }, 'Preset loaded.');
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await run(async () => {
      const json = JSON.parse(await file.text()) as unknown;
      const preview = await previewPromptPresetImport({ json, fileName: file.name });
      setImportPreview(preview);
    }, 'Import preview ready.');
    event.target.value = '';
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    await run(async () => {
      const res = await applyPromptPresetImport({ candidate: importPreview.candidate });
      setImportPreview(null);
      await loadPresets(res.preset.id);
    }, 'Prompt preset imported.');
  };

  const createManual = async () => {
    await run(async () => {
      const created = await createPromptPreset({ name: 'Manual Prompt Preset' });
      await loadPresets(created.id);
    }, 'Manual preset created.');
  };

  const saveDetails = async () => {
    if (!selected) return;
    await run(async () => {
      await updatePromptPreset(selected.id, { name: nameDraft });
      const updated = await updatePromptPresetEntries(selected.id, {
        entries: entriesDraft.map((entry, index) => ({ ...entry, orderIndex: index })),
      });
      await loadPresets(updated.id);
    }, 'Preset saved.');
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entriesDraft.length) return;
    setEntriesDraft((prev) => {
      const next = [...prev];
      const current = next[index];
      const other = next[target];
      if (!current || !other) return prev;
      next[index] = other;
      next[target] = current;
      return next.map((entry, orderIndex) => ({ ...entry, orderIndex }));
    });
  };

  const updateEntry = (
    id: string,
    patch: Partial<PromptPresetEntryDto>,
  ) => {
    setEntriesDraft((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };

  const handleExport = async () => {
    if (!selected) return;
    await run(async () => {
      const exported = await exportPromptPreset(selected.id);
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selected.name.replace(/[^a-z0-9_-]+/gi, '-') || 'prompt-preset'}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'Preset exported.');
  };

  return (
    <section className="prompt-presets-page">
      <header className="prompt-presets-header">
        <div>
          <p className="eyebrow">Prompt Library</p>
          <h2>Prompt Presets</h2>
        </div>
        <div className="action-row">
          <button className="button button--secondary" type="button" onClick={() => void createManual()} disabled={busy}>
            Create Manual
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(event) => void handleImportFile(event)}
            disabled={busy}
          />
          <button className="button button--primary" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            Import JSON
          </button>
        </div>
      </header>

      <div className="prompt-presets-layout">
        <aside className="preset-list-panel">
          {loading && <p className="empty-state">Loading presets...</p>}
          {!loading && presets.length === 0 && <p className="empty-state">No prompt presets yet.</p>}
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-list-item${preset.id === selectedId ? ' preset-list-item--selected' : ''}`}
              onClick={() => void selectPreset(preset.id)}
            >
              <span className="preset-list-title">
                {preset.name}
                {preset.isActive && <span className="active-badge">Active</span>}
              </span>
              <span>{preset.sourceType} · {preset.entryCount} entries</span>
              <span>{formatDate(preset.updatedAt)}</span>
            </button>
          ))}
        </aside>

        <section className="preset-main-panel">
          {importPreview && (
            <section className="preset-import-preview">
              <div className="preset-preview-summary">
                <strong>{importPreview.candidate.name}</strong>
                <span>{importPreview.recognizedAs}</span>
                <span>{importPreview.willCreateEntryCount} entries · {importPreview.willSkipCount} skipped</span>
              </div>
              {importPreview.warnings.length > 0 && (
                <ul className="preset-warning-list">
                  {importPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              {importPreview.ignoredFields.length > 0 && (
                <p className="preset-muted">Ignored fields: {importPreview.ignoredFields.join(', ')}</p>
              )}
              <div className="preset-entry-preview-list">
                {importPreview.entriesPreview.map((entry) => (
                  <article key={entry.id} className="preset-entry-preview">
                    <span>#{entry.orderIndex + 1}</span>
                    <span>{entry.enabled ? 'enabled' : 'disabled'}</span>
                    <span>{entry.marker ? 'marker' : 'prompt'}</span>
                    <strong>[{entry.role}] {entry.name}</strong>
                    <p>{entry.content}</p>
                  </article>
                ))}
              </div>
              <div className="action-row">
                <button className="button button--primary" type="button" onClick={() => void confirmImport()} disabled={busy}>
                  Confirm Import
                </button>
                <button className="button button--secondary" type="button" onClick={() => setImportPreview(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </section>
          )}

          {selected ? (
            <section className="preset-editor">
              <div className="preset-editor-header">
                <label className="field">
                  <span>Preset Name</span>
                  <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} disabled={busy} />
                </label>
                <div className="action-row">
                  <button className="button button--primary" type="button" onClick={() => void saveDetails()} disabled={busy}>
                    Save
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void run(async () => {
                      const activated = await activatePromptPreset(selected.id);
                      await loadPresets(activated.id);
                    }, 'Preset activated.')}
                    disabled={busy || activePresetId === selected.id}
                  >
                    Activate
                  </button>
                  <button className="button button--secondary" type="button" onClick={() => void handleExport()} disabled={busy}>
                    Export
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void run(async () => {
                      const created = await duplicatePromptPreset(selected.id);
                      await loadPresets(created.id);
                    }, 'Preset duplicated.')}
                    disabled={busy}
                  >
                    Duplicate
                  </button>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => void run(async () => {
                      await deletePromptPreset(selected.id);
                      await loadPresets(null);
                    }, 'Preset deleted.')}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="preset-entry-editor-list">
                {entriesDraft.map((entry, index) => (
                  <article key={entry.id} className="preset-entry-editor">
                    <div className="preset-entry-toolbar">
                      <strong>#{index + 1}</strong>
                      <label><input type="checkbox" checked={entry.enabled} onChange={(event) => updateEntry(entry.id, { enabled: event.target.checked })} /> Enabled</label>
                      <label><input type="checkbox" checked={entry.marker} onChange={(event) => updateEntry(entry.id, { marker: event.target.checked })} /> Marker</label>
                      <select value={entry.role} onChange={(event) => updateEntry(entry.id, { role: event.target.value as PromptPresetEntryDto['role'] })}>
                        <option value="system">system</option>
                        <option value="user">user</option>
                        <option value="assistant">assistant</option>
                      </select>
                      <button className="button button--secondary" type="button" onClick={() => moveEntry(index, -1)} disabled={index === 0}>Up</button>
                      <button className="button button--secondary" type="button" onClick={() => moveEntry(index, 1)} disabled={index === entriesDraft.length - 1}>Down</button>
                    </div>
                    <label className="field">
                      <span>Name</span>
                      <input value={entry.name} onChange={(event) => updateEntry(entry.id, { name: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Content</span>
                      <textarea rows={5} value={entry.content} onChange={(event) => updateEntry(entry.id, { content: event.target.value })} />
                    </label>
                    <p className="preset-muted">
                      identifier: {entry.identifier ?? 'none'} · injection: {entry.injectionPosition ?? 'none'} / {entry.injectionDepth ?? 'none'} / {entry.injectionOrder ?? 'none'}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <p className="empty-state">Create or import a prompt preset to begin.</p>
          )}
        </section>
      </div>

      {success && <p className="notice notice--success">{success}</p>}
      {error && <p className="notice notice--error">{error}</p>}
    </section>
  );
}
