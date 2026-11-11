// Appearance: light, dark, or the device's setting ('auto', the default).
// A plain script in the page's head, so a chosen theme is in place before the
// page is drawn (no flash of the other one). Kept on this device only, like
// the lists' sort order. app.js uses self.BITE_STAMPED_APPEARANCE.
(() => {
  const KEY = 'appearance';
  const MODES = ['auto', 'light', 'dark'];
  // The browser's bar colour (theme-color) for each theme: the page colour.
  const BAR = { light: '#ffffff', dark: '#111111' };

  const get = () => {
    try {
      const mode = localStorage.getItem(KEY);
      return MODES.includes(mode) ? mode : 'auto';
    } catch {
      return 'auto';
    }
  };

  // data-theme on <html> overrides the device's setting in app.css.
  const apply = (mode) => {
    const root = document.documentElement;
    if (mode === 'auto') delete root.dataset.theme;
    else root.dataset.theme = mode;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.dataset.scheme ||= meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = BAR[mode === 'auto' ? meta.dataset.scheme : mode];
    }
  };

  const set = (mode) => {
    if (!MODES.includes(mode)) mode = 'auto';
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch { /* private mode: still applies until the app is closed */ }
    apply(mode);
  };

  self.BITE_STAMPED_APPEARANCE = { get, set };
  apply(get());
})();
