export function getNativePlugin(name) {
  const capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;

  const existing = capacitor.Plugins?.[name];
  if (existing) return existing;

  if (typeof capacitor.isPluginAvailable === 'function' && !capacitor.isPluginAvailable(name)) {
    return null;
  }

  if (typeof capacitor.registerPlugin === 'function') {
    return capacitor.registerPlugin(name);
  }

  return null;
}
