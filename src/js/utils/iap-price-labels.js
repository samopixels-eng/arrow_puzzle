export async function applyIapPriceLabels(renderer, purchaseService, sceneName) {
  if (!renderer || !purchaseService || !sceneName) return;

  const labels = await purchaseService.getPriceLabelsByScene?.(sceneName);
  if (!labels || Object.keys(labels).length === 0) return;

  renderer.update?.(labels);
}
