import { useState } from 'react';
import type {
  ExtensionFeatureCategory,
  ExtensionFeatureDto,
  InstalledExtensionDto,
} from '@roleagent/shared';

const CATEGORY_ORDER: ExtensionFeatureCategory[] = [
  'render',
  'script',
  'tool',
  'optimization',
  'development',
  'other',
];

const CATEGORY_LABELS: Record<ExtensionFeatureCategory, string> = {
  render: '渲染',
  script: '脚本',
  tool: '工具',
  optimization: '优化',
  development: '开发',
  other: '其他',
};

interface ExtensionFeatureListProps {
  extension: InstalledExtensionDto;
  busy: boolean;
  updatingFeatureKey: string | null;
  onFeatureEnabledChange: (
    extension: InstalledExtensionDto,
    feature: ExtensionFeatureDto,
    enabled: boolean,
  ) => void;
  onRunFeature: (extension: InstalledExtensionDto, feature: ExtensionFeatureDto) => void;
}

function featureKey(extensionId: string, featureId: string): string {
  return `${extensionId}:${featureId}`;
}

function formatRunnable(feature: ExtensionFeatureDto): string {
  return feature.runnable ? '可运行' : '不可运行';
}

function formatCompatibilityNote(note: string | null): string | null {
  if (note === null) return null;
  if (note === 'External script detected, not fully compatible yet.') {
    return '检测到外部脚本；当前仅登记，不会在主页面执行。';
  }
  if (note.startsWith('External script detected, not fully compatible yet.')) {
    return '检测到外部脚本；当前仅登记，不会在主页面执行。';
  }
  if (note === 'External style detected, not fully compatible yet.') {
    return '检测到外部样式；当前仅登记，不会在主页面执行。';
  }
  if (note === 'No RoleAgent features are available for this external extension.') {
    return '该外部扩展未提供 RoleAgent 兼容功能项。';
  }
  return note;
}

export function ExtensionFeatureList({
  extension,
  busy,
  updatingFeatureKey,
  onFeatureEnabledChange,
  onRunFeature,
}: ExtensionFeatureListProps) {
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  if (extension.features.length === 0) {
    return <p className="extension-feature-empty">暂无可管理功能项</p>;
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    features: extension.features.filter((feature) => feature.category === category),
  })).filter((group) => group.features.length > 0);

  const extensionDisabled = !extension.enabled;
  const switchesDisabled = extensionDisabled || busy;

  return (
    <div className="extension-feature-list">
      {extensionDisabled && (
        <p className="notice extension-feature-disabled-notice">
          扩展已停用，功能项不会运行。
        </p>
      )}

      {grouped.map((group) => (
        <section
          className="extension-feature-category"
          key={group.category}
          aria-label={`${group.label} 功能项`}
        >
          <h5 className="extension-feature-category-title">{group.label}</h5>
          <div className="extension-feature-category-rows">
            {group.features.map((feature) => {
              const detailsOpen = expandedDetails[feature.id] === true;
              const updating = updatingFeatureKey === featureKey(extension.id, feature.id);
              const runDisabled =
                busy || updating || extensionDisabled || !feature.enabled || !feature.runnable;
              const blockedReason =
                formatCompatibilityNote(feature.compatibilityNote) ??
                (!feature.enabled ? '功能项已停用。' : !extension.enabled ? '扩展已停用。' : null);

              return (
                <article
                  className={`extension-feature-row${
                    feature.runnable ? ' extension-feature-row--runnable' : ' extension-feature-row--blocked'
                  }`}
                  key={feature.id}
                >
                  <div className="extension-feature-row-main">
                    <label className="extension-feature-toggle">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={feature.enabled}
                        disabled={switchesDisabled || updating}
                        onChange={(event) =>
                          onFeatureEnabledChange(extension, feature, event.target.checked)
                        }
                      />
                      <span>{feature.enabled ? '已启用' : '已停用'}</span>
                    </label>

                    <div className="extension-feature-summary">
                      <div className="extension-feature-title-line">
                        <strong>{feature.name}</strong>
                        <span
                          className={`extension-feature-status extension-feature-status--${
                            feature.runnable ? 'runnable' : 'blocked'
                          }`}
                        >
                          {formatRunnable(feature)}
                        </span>
                      </div>
                      <p>{feature.description ?? '暂无功能说明。'}</p>
                      {!feature.runnable && blockedReason !== null && (
                        <p className="extension-feature-blocked-reason">{blockedReason}</p>
                      )}
                    </div>

                    <div className="extension-feature-actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={busy || updating}
                        onClick={() =>
                          setExpandedDetails((current) => ({
                            ...current,
                            [feature.id]: !detailsOpen,
                          }))
                        }
                      >
                        {detailsOpen ? '收起详情' : '查看详情'}
                      </button>
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={runDisabled}
                        onClick={() => onRunFeature(extension, feature)}
                      >
                        运行
                      </button>
                    </div>
                  </div>

                  {detailsOpen && (
                    <dl className="extension-feature-details">
                      <div>
                        <dt>ID</dt>
                        <dd>{feature.id}</dd>
                      </div>
                      <div>
                        <dt>分类</dt>
                        <dd>{CATEGORY_LABELS[feature.category]}</dd>
                      </div>
                      <div>
                        <dt>Entry</dt>
                        <dd>{feature.entry ?? '未提供'}</dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>{feature.runtime}</dd>
                      </div>
                      <div>
                        <dt>默认启用</dt>
                        <dd>{feature.enabledByDefault ? '是' : '否'}</dd>
                      </div>
                      <div>
                        <dt>Runtime URL</dt>
                        <dd>{feature.runtimeUrl ?? '不可用'}</dd>
                      </div>
                      {feature.compatibilityNote !== null && (
                        <div className="extension-feature-details-wide">
                          <dt>说明</dt>
                          <dd>{formatCompatibilityNote(feature.compatibilityNote)}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
