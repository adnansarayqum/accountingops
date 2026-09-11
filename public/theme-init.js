// Applied before the app bundle loads and before first paint, so dark-mode
// users never see a flash of the light theme. Mirrors src/ui/theme.ts's
// resolution logic exactly. Lives in its own file rather than inline so the
// Content-Security-Policy can forbid inline scripts outright.
(function () {
  try {
    var stored = localStorage.getItem('practiceops.theme');
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* localStorage unavailable — default to light */
  }
})();
