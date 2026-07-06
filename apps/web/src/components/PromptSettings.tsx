import { useEffect, useState, type FormEvent } from 'react';
import type { PromptSettingsDto } from '@roleagent/shared';
import {
  getPromptSettings,
  resetPromptSettings,
  updatePromptSettings,
} from '../api';

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function PromptSettings() {
  const [roleplayPreset, setRoleplayPreset] = useState('');
  const [userPersona, setUserPersona] = useState('');
  const [authorsNote, setAuthorsNote] = useState('');
  const [userName, setUserName] = useState('User');
  const [maxPromptChars, setMaxPromptChars] = useState('24000');
  const [historyBudgetChars, setHistoryBudgetChars] = useState('12000');
  const [worldBookBudgetChars, setWorldBookBudgetChars] = useState('6000');
  const [worldBookScanDepth, setWorldBookScanDepth] = useState('3');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applySettings = (settings: PromptSettingsDto) => {
    setRoleplayPreset(settings.roleplayPreset);
    setUserPersona(settings.userPersona ?? '');
    setAuthorsNote(settings.authorsNote ?? '');
    setUserName(settings.userName);
    setMaxPromptChars(String(settings.maxPromptChars));
    setHistoryBudgetChars(String(settings.historyBudgetChars));
    setWorldBookBudgetChars(String(settings.worldBookBudgetChars));
    setWorldBookScanDepth(String(settings.worldBookScanDepth));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPromptSettings()
      .then((settings) => {
        if (cancelled) return;
        applySettings(settings);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!roleplayPreset.trim()) {
      setError('Roleplay Prompt Preset cannot be empty.');
      return;
    }
    if (!userName.trim()) {
      setError('User Name cannot be empty.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settings = await updatePromptSettings({
        roleplayPreset,
        userPersona: userPersona.trim() === '' ? null : userPersona,
        authorsNote: authorsNote.trim() === '' ? null : authorsNote,
        userName,
        maxPromptChars: toNumber(maxPromptChars, 24000),
        historyBudgetChars: toNumber(historyBudgetChars, 12000),
        worldBookBudgetChars: toNumber(worldBookBudgetChars, 6000),
        worldBookScanDepth: toNumber(worldBookScanDepth, 3),
      });
      applySettings(settings);
      setSuccess('Prompt settings saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const settings = await resetPromptSettings();
      applySettings(settings);
      setSuccess('Prompt settings reset to defaults.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="prompt-settings-panel">
      <form className="stacked-form" onSubmit={handleSave}>
        <label className="field">
          <span>User Name</span>
          <input
            type="text"
            value={userName}
            onChange={(event) => setUserName(event.target.value)}
            disabled={loading || saving}
            placeholder="User"
          />
        </label>
        <label className="field">
          <span>Roleplay Prompt Preset</span>
          <textarea
            value={roleplayPreset}
            onChange={(event) => setRoleplayPreset(event.target.value)}
            disabled={loading || saving}
            rows={7}
          />
        </label>
        <label className="field">
          <span>User Persona</span>
          <textarea
            value={userPersona}
            onChange={(event) => setUserPersona(event.target.value)}
            disabled={loading || saving}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Author's Note</span>
          <textarea
            value={authorsNote}
            onChange={(event) => setAuthorsNote(event.target.value)}
            disabled={loading || saving}
            rows={4}
          />
        </label>
        <div className="prompt-settings-grid">
          <label className="field">
            <span>Max chars</span>
            <input
              type="number"
              min="4000"
              max="200000"
              step="1000"
              value={maxPromptChars}
              onChange={(event) => setMaxPromptChars(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>History chars</span>
            <input
              type="number"
              min="0"
              max="160000"
              step="1000"
              value={historyBudgetChars}
              onChange={(event) => setHistoryBudgetChars(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>Worldbook chars</span>
            <input
              type="number"
              min="0"
              max="80000"
              step="500"
              value={worldBookBudgetChars}
              onChange={(event) => setWorldBookBudgetChars(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>Scan depth</span>
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              value={worldBookScanDepth}
              onChange={(event) => setWorldBookScanDepth(event.target.value)}
              disabled={loading || saving}
            />
          </label>
        </div>
        <button className="button button--primary" type="submit" disabled={loading || saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void handleReset()}
          disabled={loading || saving}
        >
          Reset to Default
        </button>
        {success !== null && <p className="notice notice--success">{success}</p>}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
