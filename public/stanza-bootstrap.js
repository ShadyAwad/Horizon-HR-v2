(() => {
  try {
    const theme = localStorage.getItem('horizon-theme');
    let storedPreferences = {};
    try {
      storedPreferences = JSON.parse(localStorage.getItem('stanza.preferences.v1') || '{}');
    } catch {
      storedPreferences = {};
    }

    const legacyIntensity = { bright: 15, balanced: 50, deep: 85 };
    const numericIntensity = typeof storedPreferences.lightIntensity === 'number'
      ? storedPreferences.lightIntensity
      : legacyIntensity[storedPreferences.lightIntensity];
    const safeIntensity = Number.isFinite(numericIntensity)
      ? Math.min(100, Math.max(0, Math.round(numericIntensity)))
      : 50;
    document.documentElement.dataset.lightIntensity = String(Math.round(safeIntensity / 10) * 10);

    const backgroundPresets = ['default', 'emerald', 'slate', 'midnight', 'graphite', 'warm_sand'];
    document.documentElement.dataset.backgroundPreset = backgroundPresets.includes(storedPreferences.backgroundPreset)
      ? storedPreferences.backgroundPreset
      : 'default';

    const light = theme === 'light';
    document.documentElement.classList.toggle('dark', !light);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  } catch {
    document.documentElement.dataset.backgroundPreset = 'default';
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  }
})();
