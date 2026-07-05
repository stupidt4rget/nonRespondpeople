import { useEffect, useState, type FormEvent } from 'react';
import type { LlmSettingsStatusResponse } from '@roleagent/shared';
import { getLlmSettings, saveLlmSettings } from '../api';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_MODEL = 'glm-5.2';

function getStatusText(status: LlmSettingsStatusResponse | null): string {
  if (!status) {
    return '检查中';
  }
  if (!status.configured) {
    return '未配置';
  }
  return status.source === 'env' ? '环境变量已配置' : '已配置';
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLlmSettings()
      .then((res) => {
        if (cancelled) return;
        setStatus(res);
        setBaseUrl(res.baseUrl ?? '');
        setModel(res.model ?? '');
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
      setStatus(res);
      setBaseUrl(res.baseUrl ?? baseUrl.trim());
      setModel(res.model ?? model.trim());
      setApiKey('');
      setSuccess('模型设置已保存到当前后端进程。');
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
          API Key：{status.hasApiKey ? '已配置' : '未配置'}
        </p>
      )}

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
        {success !== null && <p className="notice notice--success">{success}</p>}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
