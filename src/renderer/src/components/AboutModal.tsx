import { useEffect } from 'react';
import { FontAwesomeIcon, faXmark } from '../icons';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  version: string;
  tagline: string;
  logo: string;
  onViewGitHub: () => void;
}

/** About dialog — shows the running version, brand, and license. */
export function AboutModal({ open, onClose, name, version, tagline, logo, onViewGitHub }: AboutModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-16 w-full max-w-xs rounded-2xl border border-border bg-card p-5 text-center shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <img src={logo} alt={name} className="mx-auto -mt-2 h-16 w-16 rounded-2xl shadow-card" />
        <h2 className="mt-3 text-lg font-semibold">{name}</h2>
        <div className="mt-0.5 text-sm font-medium tabular-nums text-primary">Version {version}</div>
        <p className="mt-1 text-xs text-muted-foreground">{tagline}</p>
        <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <div>Copyright © 2026 W9MDM</div>
          <div>PolyForm Noncommercial License 1.0.0</div>
          <div>Not affiliated with AllStarLink, Inc.</div>
        </div>
        <button
          onClick={onViewGitHub}
          className="mt-4 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          View releases on GitHub
        </button>
      </div>
    </div>
  );
}
