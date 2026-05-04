// ArgoCD Mobile — site script (vanilla, no frameworks)
// Theme toggle with localStorage + system-pref fallback

(function() {
  const root = document.documentElement;
  const STORAGE_KEY = 'argocdmobile-theme';

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
  }

  // Initial: stored > system > dark
  let initial = 'dark';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      initial = stored;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      initial = 'light';
    }
  } catch (_) {}
  root.setAttribute('data-theme', initial);

  document.addEventListener('click', function(e) {
    const tgt = e.target.closest('[data-theme-toggle]');
    if (!tgt) return;
    const cur = root.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
})();
