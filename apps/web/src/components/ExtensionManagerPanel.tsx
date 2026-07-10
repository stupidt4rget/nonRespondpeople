import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ExtensionFeatureDto, InstalledExtensionDto } from '@roleagent/shared';
import {
  deleteExtension,
  fetchExtensions,
  installExtensionGit,
  installExtensionZip,
  updateExtension,
  updateExtensionFeature,
} from '../api';
import { ExtensionFeatureList } from './ExtensionFeatureList';
import { ExtensionRuntimePanel } from './ExtensionRuntimePanel';

type InstallMode = 'zip' | 'git' | null;

type ActiveRuntime =
  | { mode: 'native'; extensionId: string; featureId: string }
  | { mode: 'sillytavern-compat'; extensionId: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCompatibility(compatibility: InstalledExtensionDto['compatibility']): string {
  if (compatibility === 'roleagent') return 'RoleAgent';
  if (compatibility === 'external') return 'External';
  return '未知';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function featureKey(extensionId: string, featureId: string): string {
  return `${extensionId}:${featureId}`;
}

export function ExtensionManagerPanel() {
  const [extensions, setExtensions] = useState<InstalledExtensionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [gitUrl, setGitUrl] = useState('');
  const [installing, setInstalling] = useState<InstallMode>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingFeatureKey, setUpdatingFeatureKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedExtensionIds, setExpandedExtensionIds] = useState<Record<string, boolean>>({});
  const [activeRuntime, setActiveRuntime] = useState<ActiveRuntime | null>(null);

  const loadExtensions = useCallback(async () => {
    setLoading(true);
    try {
      setExtensions(await fetchExtensions());
      setError(null);
    } catch (loadError: unknown) {
      setError(`扩展列表加载失败：${errorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  useEffect(() => {
    if (!activeRuntime) return;
    const extension = extensions.find((item) => item.id === activeRuntime.extensionId);
    if (!extension?.enabled) {
      setActiveRuntime(null);
      return;
    }
    if (activeRuntime.mode === 'sillytavern-compat') {
      if (!extension.compatRuntimeUrl) setActiveRuntime(null);
      return;
    }
    const feature = extension.features.find((item) => item.id === activeRuntime.featureId);
    if (!feature?.enabled || !feature.runnable) {
      setActiveRuntime(null);
    }
  }, [extensions, activeRuntime]);

  const handleZipInstall = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!zipFile) {
      setError('请选择一个 .zip 扩展包。');
      return;
    }
    if (!zipFile.name.toLowerCase().endsWith('.zip')) {
      setError('只支持 .zip 扩展包。');
      return;
    }

    setInstalling('zip');
    try {
      const installed = await installExtensionZip(zipFile);
      setNotice(`已安装扩展：${installed.displayName}。扩展默认处于停用状态。`);
      setZipFile(null);
      setFileInputKey((value) => value + 1);
      await loadExtensions();
    } catch (installError: unknown) {
      setError(`ZIP 安装失败：${errorMessage(installError)}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleGitInstall = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!gitUrl.trim()) {
      setError('请输入公开的 HTTPS Git URL。');
      return;
    }

    setInstalling('git');
    try {
      const installed = await installExtensionGit({ gitUrl: gitUrl.trim() });
      setNotice(`已安装扩展：${installed.displayName}。扩展默认处于停用状态。`);
      setGitUrl('');
      await loadExtensions();
    } catch (installError: unknown) {
      setError(`Git 安装失败：${errorMessage(installError)}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleEnabledChange = async (
    extension: InstalledExtensionDto,
    enabled: boolean,
  ) => {
    setError(null);
    setNotice(null);
    setUpdatingId(extension.id);
    setExtensions((current) =>
      current.map((item) => (item.id === extension.id ? { ...item, enabled } : item)),
    );
    try {
      const updated = await updateExtension(extension.id, { enabled });
      setExtensions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (updateError: unknown) {
      setExtensions((current) =>
        current.map((item) =>
          item.id === extension.id ? { ...item, enabled: extension.enabled } : item,
        ),
      );
      setError(`扩展状态保存失败：${errorMessage(updateError)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleFeatureEnabledChange = async (
    extension: InstalledExtensionDto,
    feature: ExtensionFeatureDto,
    enabled: boolean,
  ) => {
    if (!extension.enabled) return;

    setError(null);
    setNotice(null);
    const key = featureKey(extension.id, feature.id);
    setUpdatingFeatureKey(key);
    setExtensions((current) =>
      current.map((item) => {
        if (item.id !== extension.id) return item;
        return {
          ...item,
          features: item.features.map((entry) =>
            entry.id === feature.id ? { ...entry, enabled } : entry,
          ),
        };
      }),
    );

    try {
      const updated = await updateExtensionFeature(extension.id, feature.id, { enabled });
      setExtensions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (updateError: unknown) {
      setExtensions((current) =>
        current.map((item) => (item.id === extension.id ? extension : item)),
      );
      setError(`功能项状态保存失败：${errorMessage(updateError)}`);
    } finally {
      setUpdatingFeatureKey(null);
    }
  };

  const handleRunFeature = (
    extension: InstalledExtensionDto,
    feature: ExtensionFeatureDto,
  ) => {
    if (!extension.enabled || !feature.enabled || !feature.runnable || !feature.runtimeUrl) return;
    setActiveRuntime({ mode: 'native', extensionId: extension.id, featureId: feature.id });
  };

  const handleOpenCompatRuntime = (extension: InstalledExtensionDto) => {
    if (!extension.enabled || !extension.compatRuntimeUrl) return;
    setActiveRuntime({ mode: 'sillytavern-compat', extensionId: extension.id });
  };

  const handleDelete = async (extension: InstalledExtensionDto) => {
    if (!window.confirm(`确认删除扩展“${extension.displayName}”及其安装文件？`)) return;
    setError(null);
    setNotice(null);
    setDeletingId(extension.id);
    if (activeRuntime?.extensionId === extension.id) {
      setActiveRuntime(null);
    }
    try {
      await deleteExtension(extension.id);
      setExtensions((current) => current.filter((item) => item.id !== extension.id));
      setNotice(`已删除扩展：${extension.displayName}。`);
    } catch (deleteError: unknown) {
      setError(`删除扩展失败：${errorMessage(deleteError)}`);
      await loadExtensions();
    } finally {
      setDeletingId(null);
    }
  };

  const toggleExpanded = (extensionId: string) => {
    setExpandedExtensionIds((current) => ({
      ...current,
      [extensionId]: !current[extensionId],
    }));
  };

  const busy = installing !== null;
  const runtimeExtension = activeRuntime
    ? extensions.find((item) => item.id === activeRuntime.extensionId) ?? null
    : null;
  const runtimeFeature = runtimeExtension
    && activeRuntime?.mode === 'native'
    ? runtimeExtension.features.find((item) => item.id === activeRuntime.featureId) ?? null
    : null;

  return (
    <section className="extension-manager-page" aria-labelledby="extension-manager-title">
      <header className="extension-manager-header">
        <div>
          <p className="eyebrow">Extension Manager</p>
          <h2 id="extension-manager-title">扩展程序</h2>
          <p>
            安装扩展包、管理功能项开关，并在受控 iframe 沙箱中运行已启用的扩展功能。
          </p>
        </div>
        <span className="count-pill">{extensions.length} 个已安装</span>
      </header>

      <section className="extension-install-panel" aria-labelledby="extension-install-title">
        <div className="extension-section-heading">
          <div>
            <h3 id="extension-install-title">安装扩展程序</h3>
            <p>支持不超过 20 MB 的 ZIP，或公开且不含凭证的 HTTPS Git URL。</p>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadExtensions()}
            disabled={loading || busy}
          >
            {loading ? '刷新中...' : '刷新列表'}
          </button>
        </div>

        <div className="extension-install-grid">
          <form className="extension-install-card" onSubmit={handleZipInstall}>
            <label className="field">
              <span>上传 ZIP 扩展包</span>
              <input
                key={fileInputKey}
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setZipFile(event.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </label>
            <button className="button button--primary" type="submit" disabled={busy}>
              {installing === 'zip' ? 'ZIP 安装中...' : '上传 ZIP 安装'}
            </button>
          </form>

          <form className="extension-install-card" onSubmit={handleGitInstall}>
            <label className="field">
              <span>公开 HTTPS Git URL</span>
              <input
                type="url"
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="https://github.com/example/example-extension.git"
                disabled={busy}
              />
            </label>
            <button className="button button--primary" type="submit" disabled={busy}>
              {installing === 'git' ? 'Git 安装中...' : '从 Git URL 安装'}
            </button>
          </form>
        </div>

        <label className="extension-disabled-option">
          <input type="checkbox" disabled />
          <span>在扩展程序更新时通知（后续版本）</span>
        </label>
      </section>

      {error !== null && <p className="notice notice--error" role="alert">{error}</p>}
      {notice !== null && <p className="notice notice--success">{notice}</p>}

      {runtimeExtension !== null && activeRuntime?.mode === 'sillytavern-compat' && (
        <ExtensionRuntimePanel
          key={`compat:${runtimeExtension.id}`}
          mode="sillytavern-compat"
          extension={runtimeExtension}
          onClose={() => setActiveRuntime(null)}
        />
      )}

      {runtimeExtension !== null && runtimeFeature !== null && activeRuntime?.mode === 'native' && (
        <ExtensionRuntimePanel
          key={`native:${runtimeExtension.id}:${runtimeFeature.id}`}
          mode="native"
          extension={runtimeExtension}
          feature={runtimeFeature}
          onClose={() => setActiveRuntime(null)}
        />
      )}

      <section className="extension-list-section" aria-labelledby="installed-extensions-title">
        <div className="extension-section-heading">
          <div>
            <h3 id="installed-extensions-title">已安装扩展</h3>
            <p>扩展整体启用后，可单独管理功能项并在 iframe 沙箱中运行。</p>
          </div>
        </div>

        {loading && <p className="empty-state">正在加载扩展程序...</p>}
        {!loading && extensions.length === 0 && error === null && (
          <div className="extension-empty-state">
            <strong>暂无已安装扩展程序</strong>
            <p>可上传 ZIP 或输入公开 Git URL 安装。</p>
          </div>
        )}

        {extensions.length > 0 && (
          <div className="extension-card-list">
            {extensions.map((extension) => {
              const updating = updatingId === extension.id;
              const deleting = deletingId === extension.id;
              const expanded = expandedExtensionIds[extension.id] === true;
              return (
                <article
                  className={`extension-card${expanded ? ' extension-card--expanded' : ''}`}
                  key={extension.id}
                >
                  <div className="extension-card-header">
                    <label className="extension-enabled-toggle">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={extension.enabled}
                        disabled={updating || deleting || busy}
                        onChange={(event) =>
                          void handleEnabledChange(extension, event.target.checked)
                        }
                      />
                      <span>{extension.enabled ? '已启用' : '已停用'}</span>
                    </label>
                    <div className="extension-card-title">
                      <div>
                        <h4>{extension.displayName}</h4>
                        <span className="extension-source-badge">
                          {extension.sourceType === 'git' ? 'Git' : 'ZIP'}
                        </span>
                        <span className="extension-source-badge extension-source-badge--compat">
                          {formatCompatibility(extension.compatibility)}
                        </span>
                      </div>
                      <p>{extension.description ?? '暂无扩展说明。'}</p>
                    </div>
                    <div className="extension-card-actions">
                      {extension.compatRuntimeUrl !== null && (
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={deleting || updating || busy}
                          onClick={() => handleOpenCompatRuntime(extension)}
                        >
                          实验性兼容运行
                        </button>
                      )}
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={deleting || updating || busy}
                        onClick={() => toggleExpanded(extension.id)}
                        aria-expanded={expanded}
                      >
                        {expanded ? '收起功能项' : '展开功能项'}
                      </button>
                      <button
                        className="button button--danger"
                        type="button"
                        disabled={deleting || updating || busy}
                        onClick={() => void handleDelete(extension)}
                      >
                        {deleting ? '删除中...' : '删除'}
                      </button>
                    </div>
                  </div>

                  <dl className="extension-meta-grid">
                    <div><dt>版本</dt><dd>{extension.version}</dd></div>
                    <div><dt>作者</dt><dd>{extension.author ?? '未提供'}</dd></div>
                    <div><dt>ID</dt><dd>{extension.packageName}</dd></div>
                    <div><dt>安装路径</dt><dd>{extension.installedPath}</dd></div>
                    {extension.sourceUrl !== null && (
                      <div className="extension-meta-wide">
                        <dt>来源 URL</dt><dd>{extension.sourceUrl}</dd>
                      </div>
                    )}
                    <div className="extension-meta-wide">
                      <dt>更新时间</dt><dd>{formatDate(extension.updatedAt)}</dd>
                    </div>
                  </dl>

                  {expanded && (
                    <div className="extension-card-features">
                      <ExtensionFeatureList
                        extension={extension}
                        busy={busy || updating || deleting}
                        updatingFeatureKey={updatingFeatureKey}
                        onFeatureEnabledChange={(item, feature, enabled) => {
                          void handleFeatureEnabledChange(item, feature, enabled);
                        }}
                        onRunFeature={handleRunFeature}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
