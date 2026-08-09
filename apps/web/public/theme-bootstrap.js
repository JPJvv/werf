(function () {
  try {
    var stored = localStorage.getItem('werf-theme');
    var theme = 'light';
    if (stored === 'dark') {
      theme = 'dark';
    } else if (stored === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
