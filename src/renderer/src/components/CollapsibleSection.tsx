import { useState, type ReactNode } from 'react';
import { FontAwesomeIcon, faChevronDown, faChevronRight } from '../icons';

/** Persisted collapse state per section id (pure UI state → localStorage). */
export function useCollapsed(id: string, defaultOpen: boolean): [boolean, () => void] {
  const key = `kerchunk.section.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };
  return [open, toggle];
}

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon?: Parameters<typeof FontAwesomeIcon>[0]['icon'];
  /**
   * Extra content shown at the right of the header (badges, counts, controls).
   * A function form receives the open state — handy for a compact control
   * (e.g. a small PTT button) that only appears when the section is collapsed.
   */
  right?: ReactNode | ((open: boolean) => ReactNode);
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A card section with a header that collapses/expands its body (state remembered). */
export function CollapsibleSection({
  id,
  title,
  icon,
  right,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, toggle] = useCollapsed(id, defaultOpen);
  const rightContent = typeof right === 'function' ? right(open) : right;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold"
        >
          <FontAwesomeIcon
            icon={open ? faChevronDown : faChevronRight}
            className="w-3 shrink-0 text-muted-foreground"
          />
          {icon && <FontAwesomeIcon icon={icon} className="text-muted-foreground" />}
          <span className="truncate">{title}</span>
        </button>
        {rightContent && <div className="flex shrink-0 items-center gap-2">{rightContent}</div>}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}
