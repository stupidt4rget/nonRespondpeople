import { useEffect, useState, type FormEvent } from 'react';
import type { LlmSettingsStatusResponse } from '@roleagent/shared';
import { getLlmSettings, saveLlmSettings } from '../api';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_MODEL = 'glm-5.2';
const STORAGE_KEY = 'roleagent.llmSettings';

interface StoredLlmSettings {
  baseUrl: string;
  model: string;
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
    if ('apiKey' in parsed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, model }));
    }
    if (!baseUrl && !model) return null;
    return { baseUrl, model };
  } catch {
    return null;
  }
}

function writeStoredSettings(settings: StoredLlmSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
    }
    setLoading(true);
    getLlmSettings()
      .then(async (res) => {
        if (cancelled) return;
        setStatus(res);
        if (!stored) {
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
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveLlmSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      writeStoredSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      setHasStoredSettings(true);
      setStatus(res);
      setBaseUrl(res.baseUrl ?? baseUrl.trim());
      setModel(res.model ?? model.trim());
      setApiKey('');
      setSuccess('模型设置已保存。API Key 会保存在后端数据库中，前端不会保存密钥。');
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
    setSuccess('已清除本机保存的 Base URL 和模型草稿。当前后端进程中的配置不会被清除。');
    setError(null);
  };

  const handleClearApiKey = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      setError('请先填写 API Base URL 和模型。');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveLlmSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        clearApiKey: true,
      });
      setStatus(res);
      setApiKey('');
      setSuccess('已清除后端保存的 API Key。');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
          API Key：{status.hasApiKey ? '已保存' : '未设置'}
        </p>
      )}
      <p className="secret-hint">
        API Key 只会发送到后端保存；前端本地只保存 Base URL 和模型草稿，不保存密钥。
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
            placeholder={status?.hasApiKey ? '已保存 API Key，留空将保留原值' : '未设置 API Key'}
            autoComplete="off"
          />
        </label>
        <button className="button button--primary" type="submit" disabled={loading || saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
        <button
          className="button button--danger"
          type="button"
          onClick={() => void handleClearApiKey()}
          disabled={loading || saving || !status?.hasApiKey}
        >
          清除 API Key
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
