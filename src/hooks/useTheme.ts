'use client';
import * as React from 'react';
import { THEMES, DEFAULT_THEME, isThemeId, themeById } from '@/lib/themes';
import { patch as apiPatch, describeError } from '@/lib/client/api';
import { useApp, useBoot } from '@/store/app';

const KEY = 'afs.theme';

function readDom(): string {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  return isThemeId(attr) ? attr : DEFAULT_THEME;
}

/**
 * Theme controller.
 *
 * The active palette lives on `<html data-theme>`, which the server sets from
 * the user's profile so the first paint is already correct. `apply()` flips the
 * attribute (instant, no reload) and persists to the profile in the background.
 */
export function useTheme() {
  const boot = useBoot();
  const toast = useApp(s => s.toast);
  const reload = useApp(s => s.reload);
  const [theme, setTheme] = React.useState<string>(DEFAULT_THEME);

  React.useEffect(() => {
    // Prefer: server-rendered profile → localStorage (instant for this device) → DOM.
    const fromProfile = boot?.user?.theme;
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch { /* storage disabled */ }
    const next = isThemeId(fromProfile) ? fromProfile : isThemeId(stored) ? stored : readDom();
    setTheme(next);
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', next);
  }, [boot?.user?.theme]);

  const apply = React.useCallback(async (id: string) => {
    if (!isThemeId(id)) return;
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem(KEY, id); } catch { /* storage disabled */ }
    setTheme(id);
    try {
      await apiPatch('/api/settings', { theme: id });
      await reload();
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'warn', title: 'Theme applied on this device only', body: d.title });
    }
  }, [reload, toast]);

  return { theme, setTheme: apply, themes: THEMES, current: themeById(theme) };
}
