// AdMob rewarded ad service.
// In browser mode, ads are simulated. On device, uses @capacitor-community/admob.

const TEST_REWARDED_AD_UNITS = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
};

const TEST_INTERSTITIAL_AD_UNITS = {
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios:     'ca-app-pub-3940256099942544/4411468910',
};

const TEST_BANNER_AD_UNITS = {
  android: 'ca-app-pub-3940256099942544/9214589741',
  ios: 'ca-app-pub-3940256099942544/2934735716',
};

const FALLBACK_REWARDED_AD_UNIT = TEST_REWARDED_AD_UNITS.android;
const FALLBACK_INTERSTITIAL_AD_UNIT = TEST_INTERSTITIAL_AD_UNITS.android;
const FALLBACK_BANNER_AD_UNIT = TEST_BANNER_AD_UNITS.android;

const REWARD_EVENTS = {
  FailedToLoad: 'onRewardedVideoAdFailedToLoad',
  Rewarded: 'onRewardedVideoAdReward',
  Dismissed: 'onRewardedVideoAdDismissed',
  FailedToShow: 'onRewardedVideoAdFailedToShow',
};

const INTERSTITIAL_EVENTS = {
  Loaded: 'onInterstitialAdLoaded',
  FailedToLoad: 'onInterstitialAdFailedToLoad',
  Dismissed: 'onInterstitialAdDismissed',
  FailedToShow: 'onInterstitialAdFailedToShow',
};

export class AdService {
  constructor() {
    this.admob = null;
    this.isNative = false;
    this._simulatedBannerEl = null;
    this._bannerVisible = false;
    this._rewardedReady = false;
    this._rewardedPreloading = false;
    this._rewardedShowInFlight = false;
    this._rewardedBlockerEl = null;
    this._rewardedPreloadRetryTimer = null;
    this._initPromise = this._init();
  }

  async _init() {
    try {
      const capacitor = window.Capacitor;
      if (capacitor?.isNativePlatform?.()) {
        const AdMob = capacitor.Plugins?.AdMob;
        if (!AdMob) throw new Error('AdMob plugin is not registered');

        await AdMob.initialize({ initializeForTesting: true });
        this.admob = AdMob;
        this.rewardEvents = REWARD_EVENTS;
        this.isNative = true;
        this._preloadRewardedAd();
      }
    } catch (e) {
      console.log('AdMob not available, using simulated ads:', e.message);
    }
  }

  async _preloadRewardedAd() {
    if (!this.isNative || this._rewardedReady || this._rewardedPreloading) return;
    this._rewardedPreloading = true;
    try {
      await this.admob.prepareRewardVideoAd({
        adId: this._getRewardedAdUnitId(),
        isTesting: true,
        immersiveMode: true,
      });
      this._rewardedReady = true;
    } catch (e) {
      console.log('Rewarded preload failed, will retry:', e.message);
      this._rewardedReady = false;
      if (!this._rewardedPreloadRetryTimer) {
        this._rewardedPreloadRetryTimer = setTimeout(() => {
          this._rewardedPreloadRetryTimer = null;
          this._preloadRewardedAd();
        }, 30000);
      }
    } finally {
      this._rewardedPreloading = false;
    }
  }

  async showRewardedAd(rewardType) {
    if (this._rewardedShowInFlight) return false;
    this._rewardedShowInFlight = true;
    try {
      await this._initPromise;

      if (!this.isNative) {
        return await this._showSimulatedRewardedAd(rewardType);
      }

      if (!this._rewardedReady) {
        this._showRewardedBlocker();
        try {
          await this._preloadRewardedAd();
        } finally {
          // blocker hidden after show attempt below
        }
      }

      if (!this._rewardedReady) {
        this._hideRewardedBlocker();
        return false;
      }

      const result = await this._showNativeRewardedAd();
      this._hideRewardedBlocker();
      this._rewardedReady = false;
      this._preloadRewardedAd();
      return result;
    } catch (e) {
      console.error('Ad failed:', e);
      this._hideRewardedBlocker();
      this._rewardedReady = false;
      this._preloadRewardedAd();
      return false;
    } finally {
      this._rewardedShowInFlight = false;
    }
  }

  _showRewardedBlocker() {
    if (!this._rewardedBlockerEl) {
      const blocker = document.createElement('div');
      blocker.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2600',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'background:rgba(0,0,0,0.72)',
        'pointer-events:auto',
        'touch-action:none',
        'cursor:wait',
        'font-family:Arial,sans-serif',
        'color:#fff',
      ].join(';');
      blocker.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

      const label = document.createElement('div');
      label.textContent = 'Loading ad…';
      label.style.cssText = 'font-size:16px;font-weight:700;padding:14px 22px;border-radius:10px;background:rgba(0,0,0,0.55);';
      blocker.appendChild(label);

      document.body.appendChild(blocker);
      this._rewardedBlockerEl = blocker;
    }
    this._rewardedBlockerEl.style.display = 'flex';
  }

  _hideRewardedBlocker() {
    if (this._rewardedBlockerEl) this._rewardedBlockerEl.style.display = 'none';
  }

  _getRewardedAdUnitId() {
    const platform = window.Capacitor?.getPlatform?.();
    return TEST_REWARDED_AD_UNITS[platform] ?? FALLBACK_REWARDED_AD_UNIT;
  }

  _getInterstitialAdUnitId() {
    const platform = window.Capacitor?.getPlatform?.();
    return TEST_INTERSTITIAL_AD_UNITS[platform] ?? FALLBACK_INTERSTITIAL_AD_UNIT;
  }

  _getBannerAdUnitId() {
    const platform = window.Capacitor?.getPlatform?.();
    return TEST_BANNER_AD_UNITS[platform] ?? FALLBACK_BANNER_AD_UNIT;
  }

  async showBannerAd({ margin = 0 } = {}) {
    await this._initPromise;

    if (!this.isNative) {
      this._showSimulatedBanner();
      return true;
    }

    try {
      await this.admob.showBanner({
        adId: this._getBannerAdUnitId(),
        adSize: 'BANNER',
        position: 'BOTTOM_CENTER',
        margin,
        isTesting: true,
      });
      this._bannerVisible = true;
      return true;
    } catch (e) {
      console.error('Banner failed:', e);
      return false;
    }
  }

  async hideBannerAd() {
    await this._initPromise;

    if (!this.isNative) {
      this._removeSimulatedBanner();
      return true;
    }

    try {
      await this.admob.removeBanner();
      this._bannerVisible = false;
      return true;
    } catch (e) {
      console.error('Banner remove failed:', e);
      return false;
    }
  }

  async showInterstitialAd() {
    await this._initPromise;

    if (!this.isNative) {
      return this._showSimulatedInterstitial();
    }

    try {
      const adId = this._getInterstitialAdUnitId();
      await this.admob.prepareInterstitial({
        adId,
        isTesting: true,
      });
      return await this._showNativeInterstitial();
    } catch (e) {
      console.error('Interstitial failed:', e);
      return false;
    }
  }

  async _showNativeInterstitial() {
    const handles = [];
    const cleanup = () => {
      handles.forEach(handle => handle?.remove?.());
      handles.length = 0;
    };

    return new Promise(async (resolve) => {
      const finish = (shown) => {
        cleanup();
        resolve(shown);
      };

      try {
        handles.push(await this.admob.addListener(INTERSTITIAL_EVENTS.Dismissed, () => finish(true)));
        handles.push(await this.admob.addListener(INTERSTITIAL_EVENTS.FailedToShow, () => finish(false)));
        handles.push(await this.admob.addListener(INTERSTITIAL_EVENTS.FailedToLoad, () => finish(false)));

        await this.admob.showInterstitial();
      } catch (e) {
        console.error('Interstitial show failed:', e);
        finish(false);
      }
    });
  }

  _showSimulatedInterstitial() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:10000',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:rgba(0,0,0,0.92)',
        'font-family:Arial,sans-serif',
        'color:#fff',
      ].join(';');

      const panel = document.createElement('div');
      panel.style.cssText = [
        'width:min(320px,82vw)',
        'padding:22px',
        'border-radius:12px',
        'background:#13202a',
        'box-shadow:0 16px 40px rgba(0,0,0,0.45)',
        'text-align:center',
      ].join(';');

      const title = document.createElement('div');
      title.textContent = 'Test Interstitial Ad';
      title.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:10px;';

      const body = document.createElement('div');
      body.textContent = '(forced ad preview)';
      body.style.cssText = 'font-size:14px;opacity:0.78;margin-bottom:18px;';

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.style.cssText = [
        'width:100%',
        'height:44px',
        'border:0',
        'border-radius:8px',
        'background:#35c56b',
        'color:#07130b',
        'font-size:15px',
        'font-weight:800',
        'cursor:pointer',
      ].join(';');

      const done = (shown) => {
        overlay.remove();
        resolve(shown);
      };

      close.addEventListener('click', () => done(true), { once: true });

      panel.append(title, body, close);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });
  }

  _showSimulatedBanner() {
    this._removeSimulatedBanner();

    const banner = document.createElement('div');
    banner.textContent = 'Test Banner Ad';
    banner.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:0',
      'transform:translateX(-50%)',
      'z-index:1600',
      'width:min(320px,100vw)',
      'height:calc(50px + env(safe-area-inset-bottom, 0px))',
      'padding-bottom:env(safe-area-inset-bottom, 0px)',
      'box-sizing:border-box',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:#f1f3f4',
      'border-top:1px solid rgba(0,0,0,0.18)',
      'color:#3c4043',
      'font:700 13px Arial,sans-serif',
      'pointer-events:none',
    ].join(';');

    document.body.appendChild(banner);
    this._simulatedBannerEl = banner;
    this._bannerVisible = true;
  }

  _removeSimulatedBanner() {
    this._simulatedBannerEl?.remove?.();
    this._simulatedBannerEl = null;
    this._bannerVisible = false;
  }

  async _showNativeRewardedAd() {
    const handles = [];
    const cleanup = () => {
      handles.forEach(handle => handle?.remove?.());
      handles.length = 0;
    };

    return new Promise(async (resolve) => {
      const finish = (rewarded) => {
        cleanup();
        resolve(rewarded);
      };

      try {
        handles.push(await this.admob.addListener(this.rewardEvents.Rewarded, () => finish(true)));
        handles.push(await this.admob.addListener(this.rewardEvents.Dismissed, () => finish(false)));
        handles.push(await this.admob.addListener(this.rewardEvents.FailedToShow, () => finish(false)));
        handles.push(await this.admob.addListener(this.rewardEvents.FailedToLoad, () => finish(false)));

        await this.admob.showRewardVideoAd();
      } catch (e) {
        console.error('Ad show failed:', e);
        finish(false);
      }
    });
  }

  _showSimulatedRewardedAd(rewardType) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:10000',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:rgba(0,0,0,0.82)',
        'font-family:Arial,sans-serif',
        'color:#fff',
      ].join(';');

      const panel = document.createElement('div');
      panel.style.cssText = [
        'width:min(320px,82vw)',
        'padding:22px',
        'border-radius:12px',
        'background:#202633',
        'box-shadow:0 16px 40px rgba(0,0,0,0.45)',
        'text-align:center',
      ].join(';');

      const title = document.createElement('div');
      title.textContent = 'Test Rewarded Ad';
      title.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:10px;';

      const body = document.createElement('div');
      body.textContent = rewardType === 'coins' ? 'Coin reward ad preview' : 'Heart refill ad preview';
      body.style.cssText = 'font-size:14px;opacity:0.78;margin-bottom:18px;';

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Complete Ad';
      button.style.cssText = [
        'width:100%',
        'height:44px',
        'border:0',
        'border-radius:8px',
        'background:#35c56b',
        'color:#07130b',
        'font-size:15px',
        'font-weight:800',
        'cursor:pointer',
      ].join(';');

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.style.cssText = [
        'margin-top:10px',
        'width:100%',
        'height:38px',
        'border:1px solid rgba(255,255,255,0.28)',
        'border-radius:8px',
        'background:transparent',
        'color:#fff',
        'font-size:14px',
        'cursor:pointer',
      ].join(';');

      const done = (rewarded) => {
        overlay.remove();
        resolve(rewarded);
      };

      button.addEventListener('click', () => done(true), { once: true });
      close.addEventListener('click', () => done(false), { once: true });

      panel.append(title, body, button, close);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });
  }
}
