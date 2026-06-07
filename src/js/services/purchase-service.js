import { SUPABASE_URL, SUPABASE_ANON } from '../constants.js';
import { REVENUECAT_ANDROID_API_KEY } from '../data/iap-config.js';
import { showToast } from '../utils/toast.js';
import { getNativePlugin } from '../utils/capacitor-plugins.js';

export class PurchaseService {
  constructor({
    authService,
    coinService,
    itemService,
    cloudSaveService,
  } = {}) {
    this._auth = authService;
    this._coinService = coinService;
    this._itemService = itemService;
    this._cloudSaveService = cloudSaveService;
    this._catalog = null;
    this._productsMap = null;
    this._priceLabelsByScene = {};
    this._purchases = null;
    this._configuredAppUserId = null;
    this._initPromise = null;
  }

  get isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  async init() {
    if (!this._initPromise) this._initPromise = this._init();
    return this._initPromise;
  }

  async syncIdentity() {
    if (!this.isNative || !this._purchases) return false;
    const appUserID = await this._getRevenueCatAppUserId();
    if (!appUserID || appUserID === this._configuredAppUserId) return true;
    await this._purchases.logIn({ appUserID });
    this._configuredAppUserId = appUserID;
    this._productsMap = null;
    this._priceLabelsByScene = {};
    return true;
  }

  async getPriceLabelsByScene(sceneName) {
    try {
      await this.init();
      if (!sceneName || !this.isNative || !this._purchases) return {};
      if (this._priceLabelsByScene[sceneName]) return this._priceLabelsByScene[sceneName];

      if (!this._catalog || this._catalog.length === 0) {
        this._catalog = await this._loadCatalog();
      }
      const productsMap = await this._getProductsMap();
      const labels = {};

      for (const product of this._catalog) {
        const sceneSlots = product.slots?.filter?.((slot) => slot.scene_name === sceneName) ?? [];
        if (sceneSlots.length === 0) continue;

        const priceLabel = productsMap.get(product.store_product_id)?.priceString;
        if (!priceLabel) continue;

        for (const slot of sceneSlots) {
          if (slot.binding_key) labels[slot.binding_key] = priceLabel;
          labels[slot.click_event] = priceLabel;
        }
      }

      this._priceLabelsByScene[sceneName] = labels;
      return labels;
    } catch (error) {
      console.warn('[PurchaseService] price label lookup failed:', error);
      return {};
    }
  }

  async purchaseByEvent(clickEvent, { sceneName = null } = {}) {
    try {
      await this._cloudSaveService?.uploadNow?.();
      await this.init();

      const product = await this._findProductByEvent(clickEvent, sceneName);
      if (!product) {
        this._toast('This product is not available.');
        return false;
      }

      if (!this.isNative) {
        this._toast('Purchases are available in the Android test build.');
        return false;
      }
      if (!this._purchases) {
        this._toast('Store is not configured yet.');
        return false;
      }

      const productsMap = await this._getProductsMap();
      const storeProduct = productsMap.get(product.store_product_id);
      if (!storeProduct) {
        this._toast('Store product is not ready yet.');
        return false;
      }

      this._toast('Opening purchase...', { duration: 1200 });
      const result = await this._purchases.purchaseStoreProduct({ product: storeProduct });
      const transaction = result?.transaction ?? {};
      const response = await this._finalizePurchase(product, result, transaction, {
        sceneName,
        clickEvent,
      });

      if (response?.state) {
        await this._cloudSaveService?.applySnapshot?.(response.state);
        this._cloudSaveService?.markClean?.();
      } else {
        this._applyRewardsLocally(response?.rewards ?? []);
      }

      this._toast(response?.duplicate ? 'Purchase already applied.' : 'Purchase complete.');
      return true;
    } catch (error) {
      if (error?.userCancelled) return false;
      console.warn('[PurchaseService] purchase failed:', error);
      this._toast('Purchase failed. Please try again.');
      return false;
    }
  }

  async _init() {
    try {
      this._catalog = await this._loadCatalog();
    } catch (error) {
      console.warn('[PurchaseService] catalog load failed:', error);
      this._catalog = [];
    }
    if (!this.isNative) return true;
    if (!REVENUECAT_ANDROID_API_KEY) {
      console.warn('[PurchaseService] REVENUECAT_ANDROID_API_KEY is not configured.');
      return false;
    }

    const Purchases = getNativePlugin('Purchases');
    if (!Purchases) {
      console.warn('[PurchaseService] Purchases plugin is not registered.');
      return false;
    }

    this._purchases = Purchases;
    const appUserID = await this._getRevenueCatAppUserId();
    await Purchases.configure({
      apiKey: REVENUECAT_ANDROID_API_KEY,
      appUserID,
    });
    this._configuredAppUserId = appUserID;
    return true;
  }

  async _loadCatalog() {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/iap-catalog?platform=android`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`iap-catalog failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    return Array.isArray(data.products) ? data.products : [];
  }

  async _findProductByEvent(clickEvent, sceneName) {
    if (!this._catalog || this._catalog.length === 0) {
      this._catalog = await this._loadCatalog();
    }
    const candidates = this._catalog.filter((product) =>
      product.slots?.some?.((slot) => slot.click_event === clickEvent)
    );
    if (sceneName) {
      const exact = candidates.find((product) =>
        product.slots?.some?.((slot) => slot.click_event === clickEvent && slot.scene_name === sceneName)
      );
      if (exact) return exact;
    }
    return candidates[0] ?? null;
  }

  async _getProductsMap() {
    if (!this._productsMap) {
      const ids = (this._catalog ?? [])
        .map((p) => p.store_product_id)
        .filter(Boolean);
      if (ids.length === 0) {
        this._productsMap = new Map();
      } else {
        const result = await this._purchases.getProducts({
          productIdentifiers: ids,
          type: 'NON_SUBSCRIPTION',
        });
        const list = Array.isArray(result?.products) ? result.products : [];
        this._productsMap = new Map(list.map((p) => [p.identifier, p]));
      }
    }
    return this._productsMap;
  }

  async _finalizePurchase(product, result, transaction, { sceneName, clickEvent }) {
    const identity = await this._auth.getIdentityPayload();
    const appUserId = await this._getRevenueCatAppUserId();
    const transactionId = transaction.transactionIdentifier || transaction.purchaseToken || null;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/iap-finalize-purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        ...identity,
        platform: 'android',
        store_product_id: product.store_product_id,
        transaction_id: transactionId,
        purchase_token: transaction.purchaseToken ?? null,
        revenuecat_app_user_id: appUserId,
        purchased_at: transaction.purchaseDate ?? null,
        source_scene: sceneName,
        source_event: clickEvent,
        purchase_result: result,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`iap-finalize-purchase failed: ${res.status} ${body}`);
    }
    return res.json();
  }

  async _getRevenueCatAppUserId() {
    return await this._auth?.getPreference?.('server_user_id')
      || await this._auth?.getUserId?.()
      || null;
  }

  _applyRewardsLocally(rewards) {
    for (const reward of rewards) {
      if (reward.reward_type === 'coin') {
        this._coinService?.add?.(reward.amount);
      } else if (reward.reward_type === 'item' && reward.reward_key) {
        this._itemService?.add?.(reward.reward_key, reward.amount);
      }
    }
  }

  _toast(message, options = {}) {
    showToast(message, {
      fontSize: '14px',
      padding: '14px 22px',
      duration: 2200,
      fadeMs: 220,
      maxWidth: '80vw',
      ...options,
    });
  }
}
