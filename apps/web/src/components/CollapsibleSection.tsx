import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  eyebrow?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  eyebrow,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`collapsible-section${open ? ' collapsible-section--open' : ''}`}>
      <button
        className="collapsible-trigger"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="collapsible-title-group">
          {eyebrow !== undefined && <span className="eyebrow">{eyebrow}</span>}
          <span className="collapsible-title">{title}</span>
        </span>
        <span className="collapsible-meta">
          {badge}
          <span className="collapsible-chevron" aria-hidden="true">
            {open ? '收起' : '展开'}
          </span>
        </span>
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </section>
  );
}
