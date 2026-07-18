export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeState {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
}

export const THEME_CHANNELS = {
  GET_STATE: 'theme:get-state',
  SET_MODE: 'theme:set-mode',
  STATE_CHANGED: 'theme:state-changed',
} as const;

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return mode;
}
