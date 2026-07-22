import { CollapsibleSection } from './CollapsibleSection';
import { faListUl } from '../icons';

export interface ActivityEntry {
  /** Local time string, e.g. "14:32:09". */
  time: string;
  message: string;
}

interface ActivityLogProps {
  entries: ActivityEntry[];
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <CollapsibleSection id="activity" title="Activity" icon={faListUl} defaultOpen={false}>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1 font-mono text-xs text-muted-foreground">
        {entries.length === 0 ? (
          <div>No activity yet.</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.time}-${index}`}
              className={`flex gap-2 rounded-lg px-3 py-1.5 ${index === 0 ? 'bg-accent text-foreground' : 'bg-transparent'}`}
            >
              <span className="shrink-0 tabular-nums text-muted-foreground/70">{entry.time}</span>
              <span className="min-w-0 break-words">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}
