'use client';

import { useEffect, useState } from 'react';

type ThemeChoice = 'system' | 'light' | 'dark';

function applyTheme(choice: ThemeChoice) {
  const isDark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = window.localStorage.getItem('matchpilot-theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    applyTheme(choice);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => {
      if ((window.localStorage.getItem('matchpilot-theme') ?? 'system') === 'system') applyTheme('system');
    };
    media.addEventListener('change', syncSystem);
    return () => media.removeEventListener('change', syncSystem);
  }, [choice]);

  const change = (next: ThemeChoice) => {
    setChoice(next);
    if (next === 'system') window.localStorage.removeItem('matchpilot-theme');
    else window.localStorage.setItem('matchpilot-theme', next);
    applyTheme(next);
  };

  return <label className="theme-toggle" title="表示テーマ"><span aria-hidden="true">◐</span><span className="sr-only">表示テーマ</span><select suppressHydrationWarning value={choice} onChange={(event) => change(event.target.value as ThemeChoice)} aria-label="表示テーマ"><option value="system">自動</option><option value="light">ライト</option><option value="dark">ダーク</option></select></label>;
}
