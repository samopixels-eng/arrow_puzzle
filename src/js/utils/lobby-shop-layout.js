// lobby-shop.contract.json 을 entitlements 에 따라 메모리상에서 변형.
// contract.json 자체는 ui-editor 전용 — 절대 수정 금지.
// no_ads 보유 시: noads / noads_bundle 그룹 숨김 + Golden_offer 그룹을 noads 자리로 이동.

const HIDDEN_GROUPS = ['noads', 'noad_bundle'];
const GOLDEN_GROUP = 'Golden_offer';
// noads 그룹 헤드(buy_noads y=714) ~ Golden_offer 그룹 헤드(buy_golden_offer y=1083) 거리.
const GOLDEN_SHIFT_Y = 1083 - 714;

// lobby-map 에서 no_ads 보유 시 숨길 레이어 (광고 제거 상품 진입 아이콘).
const LOBBY_MAP_NOADS_LAYERS = ['no-ads-webp-982'];

export function applyEntitlementsToLobbyShop(contract, entitlements) {
  const cloned = JSON.parse(JSON.stringify(contract));
  if (!entitlements?.no_ads) return cloned;

  const groups = Array.isArray(cloned.groups) ? cloned.groups : [];
  const layers = Array.isArray(cloned.layers) ? cloned.layers : [];

  const hiddenIds = new Set();
  for (const g of groups) {
    if (HIDDEN_GROUPS.includes(g.name)) {
      (g.layerStableIds ?? []).forEach(id => hiddenIds.add(id));
    }
  }
  for (const layer of layers) {
    if (hiddenIds.has(layer.stableId)) layer.visible = false;
  }

  const goldenGroup = groups.find(g => g.name === GOLDEN_GROUP);
  if (goldenGroup) {
    const goldenIds = new Set(goldenGroup.layerStableIds ?? []);
    for (const layer of layers) {
      if (goldenIds.has(layer.stableId) && Number.isFinite(layer.y)) {
        layer.y -= GOLDEN_SHIFT_Y;
      }
    }
  }

  return cloned;
}

export function applyEntitlementsToLobbyMap(contract, entitlements) {
  const cloned = JSON.parse(JSON.stringify(contract));
  if (!entitlements?.no_ads) return cloned;

  const layers = Array.isArray(cloned.layers) ? cloned.layers : [];
  const hidden = new Set(LOBBY_MAP_NOADS_LAYERS);
  for (const layer of layers) {
    if (hidden.has(layer.stableId)) layer.visible = false;
  }
  return cloned;
}
