import type { UpdateInfoDto } from '../../../shared/ipc';
import { FontAwesomeIcon, faRotate, faXmark } from '../icons';

/** Tags we allow through from release notes; everything else is unwrapped to its text. */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'A', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'HR', 'DIV', 'SPAN',
]);

/**
 * Sanitize GitHub release-notes HTML for safe rendering: keep a whitelist of
 * formatting tags, drop everything else (scripts, styles, event handlers), and
 * keep only http(s) hrefs on links. Runs in the renderer, where DOMParser lives.
 */
function sanitizeNotesHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Unwrap disallowed elements: replace with their (cleaned) contents.
          walk(el);
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        // Strip every attribute except a validated href on <a>.
        for (const attr of Array.from(el.attributes)) {
          const keep = el.tagName === 'A' && attr.name === 'href' && /^https?:\/\//i.test(attr.value);
          if (!keep) el.removeAttribute(attr.name);
        }
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const looksLikeHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

interface UpdateBannerProps {
  info: UpdateInfoDto | null;
  /** Download percent (0–100) while downloading; null when not downloading. */
  progress: number | null;
  downloaded: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onViewGitHub: (url: string) => void;
}

/** Modal shown when a GitHub update is available — changelog + update actions. */
export function UpdateBanner({ info, progress, downloaded, onDownload, onInstall, onDismiss, onViewGitHub }: UpdateBannerProps) {
  if (!info) return null;
  const downloading = progress !== null && !downloaded;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <div className="mt-10 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FontAwesomeIcon icon={faRotate} className="text-primary" /> Update available
          </h2>
          <button onClick={onDismiss} title="Later" aria-label="Dismiss" className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Version <span className="font-semibold text-foreground">{info.version}</span> is available.
        </p>

        {info.notes && (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What's new</div>
            {looksLikeHtml(info.notes) ? (
              <div
                onClick={(e) => {
                  // Open links in the system browser; a bare <a> would navigate the app window away.
                  const a = (e.target as HTMLElement).closest('a');
                  if (a?.getAttribute('href')) {
                    e.preventDefault();
                    onViewGitHub(a.getAttribute('href')!);
                  }
                }}
                className="space-y-2 text-xs leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:mb-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(info.notes) }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">{info.notes}</pre>
            )}
          </div>
        )}

        {downloading && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Downloading…</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => onViewGitHub(info.releasesUrl)} className="mr-auto text-xs font-medium text-primary hover:underline">
            View on GitHub
          </button>
          {downloaded ? (
            <button onClick={onInstall} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">
              Restart &amp; install
            </button>
          ) : (
            <>
              <button onClick={onDismiss} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-accent">
                Later
              </button>
              <button onClick={onDownload} disabled={downloading} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50">
                {downloading ? 'Downloading…' : 'Update now'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
