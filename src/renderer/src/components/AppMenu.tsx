import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FontAwesomeIcon,
  faBars,
  faGear,
  faTowerBroadcast,
  faIdCard,
  faRotate,
  faLinkSlash,
  faCircleInfo,
  faBolt,
  faCircleCheck,
  faWandMagicSparkles,
  faUpRightFromSquare,
} from '../icons';

interface AppMenuProps {
  onSettings: () => void;
  onDirectory: () => void;
  onRegister: () => void;
  onRefresh: () => void;
  onDisconnectAll: () => void;
  onAbout: () => void;
  onSetupWizard: () => void;
  onCheckUpdates: () => void;
  canDisconnect: boolean;
  advancedMode: boolean;
  onToggleAdvanced: () => void;
  overlayEnabled: boolean;
  onToggleOverlay: () => void;
}

/** In-app icon menu (hamburger → dropdown of icon actions). */
export function AppMenu(props: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (
    icon: Parameters<typeof FontAwesomeIcon>[0]['icon'],
    label: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <FontAwesomeIcon icon={icon} className="w-4 text-muted-foreground" />
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        aria-label="Menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <FontAwesomeIcon icon={faBars} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-56 rounded-xl border border-border bg-card p-1.5 shadow-card">
          {item(faTowerBroadcast, 'Node directory', props.onDirectory)}
          {item(faIdCard, 'Register with AllStarLink', props.onRegister)}
          {item(faRotate, 'Refresh network', props.onRefresh)}
          {item(faLinkSlash, 'Disconnect all', props.onDisconnectAll, !props.canDisconnect)}
          <div className="my-1 border-t border-border" />
          {item(
            faUpRightFromSquare,
            <span className="flex flex-1 items-center justify-between gap-2">
              Floating PTT
              {props.overlayEnabled && <FontAwesomeIcon icon={faCircleCheck} className="text-primary" />}
            </span>,
            props.onToggleOverlay,
          )}
          {item(
            faBolt,
            <span className="flex flex-1 items-center justify-between gap-2">
              Advanced mode
              {props.advancedMode && <FontAwesomeIcon icon={faCircleCheck} className="text-primary" />}
            </span>,
            props.onToggleAdvanced,
          )}
          {item(faGear, 'Settings', props.onSettings)}
          {item(faWandMagicSparkles, 'Setup wizard', props.onSetupWizard)}
          {item(faRotate, 'Check for updates', props.onCheckUpdates)}
          {item(faCircleInfo, 'About Kerchunk', props.onAbout)}
        </div>
      )}
    </div>
  );
}
