(() => {
  try {
    const savedTheme = localStorage.getItem('matchpilot-theme');
    const dark = savedTheme === 'dark'
      || (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    // Storage can be unavailable in hardened browser modes; system colors remain usable.
  }
})();
