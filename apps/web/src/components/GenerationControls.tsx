import { useEffect, useState, type FormEvent } from 'react';
import type { GenerationSettingsDto } from '@roleagent/shared';
import {
  resetGenerationSettings,
  updateGenerationSettings,
} from '../api';

interface GenerationControlsProps {
  settings: GenerationSettingsDto | null;
  onSettingsChange: (settings: GenerationSettingsDto) => void;
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function GenerationControls({
  settings,
  onSettingsChange,
}: GenerationControlsProps) {
  const [contextUnlockEnabled, setContextUnlockEnabled] = useState(false);
  const [contextLimitTokens, setContextLimitTokens] = useState('200000');
  const [maxReplyTokens, setMaxReplyTokens] = useState('65536');
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState('1');
  const [frequencyPenalty, setFrequencyPenalty] = useState('0');
  const [presencePenalty, setPresencePenalty] = useState('0');
  const [topP, setTopP] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const contextMax = contextUnlockEnabled ? 2000000 : 200000;
  const loading = settings === null;

  const applySettings = (next: GenerationSettingsDto) => {
    setContextUnlockEnabled(next.contextUnlockEnabled);
    setContextLimitTokens(String(next.contextLimitTokens));
    setMaxReplyTokens(String(next.maxReplyTokens));
    setStreamEnabled(next.streamEnabled);
    setTemperature(String(next.temperature));
    setFrequencyPenalty(String(next.frequencyPenalty));
    setPresencePenalty(String(next.presencePenalty));
    setTopP(String(next.topP));
  };

  useEffect(() => {
    if (settings) applySettings(settings);
  }, [settings]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateGenerationSettings({
        contextUnlockEnabled,
        contextLimitTokens: toNumber(contextLimitTokens, 200000),
        maxReplyTokens: toNumber(maxReplyTokens, 65536),
        responseCount: 1,
        streamEnabled,
        temperature: toNumber(temperature, 1),
        frequencyPenalty: toNumber(frequencyPenalty, 0),
        presencePenalty: toNumber(presencePenalty, 0),
        topP: toNumber(topP, 1),
      });
      onSettingsChange(saved);
      applySettings(saved);
      setSuccess('Generation controls saved.');
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
      const saved = await resetGenerationSettings();
      onSettingsChange(saved);
      applySettings(saved);
      setSuccess('Generation controls reset.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="generation-controls-panel">
      <form className="stacked-form" onSubmit={handleSave}>
        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={streamEnabled}
            onChange={(event) => setStreamEnabled(event.target.checked)}
            disabled={loading || saving}
          />
          <span>流式传输</span>
        </label>

        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={contextUnlockEnabled}
            onChange={(event) => setContextUnlockEnabled(event.target.checked)}
            disabled={loading || saving}
          />
          <span>解锁上下文上限</span>
        </label>

        <div className="generation-controls-grid">
          <label className="field">
            <span>上下文长度 Token</span>
            <input
              type="number"
              min="1024"
              max={contextMax}
              step="512"
              value={contextLimitTokens}
              onChange={(event) => setContextLimitTokens(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>最大回复长度 Token</span>
            <input
              type="number"
              min="1"
              max="128000"
              step="64"
              value={maxReplyTokens}
              onChange={(event) => setMaxReplyTokens(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>温度</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>Top P</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={topP}
              onChange={(event) => setTopP(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>频率惩罚</span>
            <input
              type="number"
              min="-2"
              max="2"
              step="0.05"
              value={frequencyPenalty}
              onChange={(event) => setFrequencyPenalty(event.target.value)}
              disabled={loading || saving}
            />
          </label>
          <label className="field">
            <span>存在惩罚</span>
            <input
              type="number"
              min="-2"
              max="2"
              step="0.05"
              value={presencePenalty}
              onChange={(event) => setPresencePenalty(event.target.value)}
              disabled={loading || saving}
            />
          </label>
        </div>

        <p className="generation-controls-hint">
          高上限仅表示 RoleAgent 允许请求，实际可用长度取决于模型与服务商。
        </p>

        <label className="field">
          <span>每次生成备选回复</span>
          <input type="number" value="1" disabled />
          <small>暂未支持多备选回复，本轮固定为 1。</small>
        </label>

        <button className="button button--primary" type="submit" disabled={loading || saving}>
          {saving ? 'Saving...' : 'Save Generation Controls'}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void handleReset()}
          disabled={loading || saving}
        >
          Reset Generation Controls
        </button>
        {success !== null && <p className="notice notice--success">{success}</p>}
        {error !== null && <p className="notice notice--error">{error}</p>}
      </form>
    </section>
  );
}
