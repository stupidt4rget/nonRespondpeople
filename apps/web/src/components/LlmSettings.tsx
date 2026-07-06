import { useEffect, useState, type FormEvent } from 'react';
import type { LlmSettingsStatusResponse } from '@roleagent/shared';
import { getLlmSettings, saveLlmSettings } from '../api';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_MODEL = 'glm-5.2';
const STORAGE_KEY = 'roleagent.llmSettings';

interface StoredLlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

function getStatusText(status: LlmSettingsStatusResponse | null): string {
  if (!status) {
    return '检查中';
  }
  if (!status.configured) {
    return '未配置';
  }
  return status.source === 'env' ? '环境变量已配置' : '已配置';
}

function readStoredSettings(): StoredLlmSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLlmSettings>;
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '';
    const model = typeof parsed.model === 'string' ? parsed.model : '';
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    if (!baseUrl && !model && !apiKey) return null;
    return { baseUrl, model, apiKey };
  } catch {
    return null;
  }
}

function writeStoredSettings(settings: StoredLlmSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function hasCompleteSettings(settings: StoredLlmSettings): boolean {
  return (
    settings.baseUrl.trim() !== '' &&
    settings.model.trim() !== '' &&
    settings.apiKey.trim() !== ''
  );
}

export function LlmSettings() {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<LlmSettingsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasStoredSettings, setHasStoredSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredSettings();
    if (stored) {
      setHasStoredSettings(true);
      setBaseUrl(stored.baseUrl);
      setModel(stored.model);
      setApiKey(stored.apiKey);
    }
    setLoading(true);
    getLlmSettings()
      .then(async (res) => {
        if (cancelled) return;
        setStatus(res);
        if (stored) {
          if (hasCompleteSettings(stored)) {
            const saved = await saveLlmSettings({
              baseUrl: stored.baseUrl.trim(),
              model: stored.model.trim(),
              apiKey: stored.apiKey.trim(),
            });
            if (cancelled) return;
            setStatus(saved);
            setSuccess('已从本机保存的 API 配置恢复到当前后端进程。');
          }
        } else {
          setBaseUrl(res.baseUrl ?? '');
          setModel(res.model ?? '');
        }
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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim()) {
      setError('API Base URL 不能为空');
      return;
    }
    if (!model.trim()) {
      setError('模型不能为空');
      return;
    }
    if (!apiKey.trim()) {
      setError('API Key 不能为空');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveLlmSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
      });
      writeStoredSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
      });
      setHasStoredSettings(true);
      setStatus(res);
      setBaseUrl(res.baseUrl ?? baseUrl.trim());
      setModel(res.model ?? model.trim());
      setApiKey(apiKey.trim());
      setSuccess('模型设置已保存到当前后端进程，并保存到本机。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearStored = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setHasStoredSettings(false);
    setApiKey('');
    setSuccess('已清除本机保存的 API 配置。当前后端进程中的配置不会被清除。');
    setError(null);
  };

  return (
    <section className="llm-settings-panel">
      <div className="section-heading section-heading--row">
        <div>
          <p className="eyebrow">LLM API</p>
          <h2>模型设置</h2>
        </div>
        <span
          className={`settings-status${
            status?.configured ? ' settings-status--configured' : ''
          }`}
        >
          {loading ? '检查中' : getStatusText(status)}
        </span>
      </div>

      {status?.configured && (
        <p className="secret-hint">
          API Key：{status.hasApiKey ? '已配置' : '未配置'}
        </p>
      )}
      <p className="secret-hint">
        API Key 将保存在本机浏览器/桌面应用数据中。
      </p>

      <form className="stacked-form" onSubmit={handleSave}>
        <label className="field">
          <span>API Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={loading || saving}
            placeholder={DEFAULT_BASE_URL}
          />
        </label>
        <label className="field">
          <span>模型</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={loading || saving}
            placeholder={DEFAULT_MODEL}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={loading || saving}
            placeholder="你的 API Key"
            autoComplete="off"
          />
        </label>
        <button className="button button--primary" type="submit" disabled={loading || saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={handleClearStored}
          disabled={loading || saving || !hasStoredSettings}
        >
          清除本地保存的 API 配置
        </button>
        {success !== null && <p className="notice notice--success">{success}</p>}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
