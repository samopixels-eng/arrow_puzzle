import { SceneRenderer } from '../scene-renderer.js';
import { applyScale }    from '../utils/scaler.js';

const DESIGN_W = 390;
const DESIGN_H = 844;

export class ClearScreen {
  constructor(container, callbacks, coinService, soundService) {
    this.container    = container;
    this.callbacks    = callbacks; // { onNextLevel, onWatchAd }
    this.coinService  = coinService;
    this.soundService = soundService;

    this._wrapper      = null;
    this._inner        = null;
    this._renderer     = null;
    this._adBusy       = false;
    this._bannerRequested = false;
    this._resizeHandler = null;
  }

  async show() {
    // 인게임 위에 오버레이 (z-index 1500)
    this._wrapper = document.createElement('div');
    this._wrapper.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1500',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:transparent',
      'opacity:0', 'transition:opacity 250ms ease-out',
    ].join(';');
    document.body.appendChild(this._wrapper);

    this._inner = document.createElement('div');
    this._inner.style.cssText = 'position:absolute;inset:0;';
    this._wrapper.appendChild(this._inner);

    this._renderer = new SceneRenderer(this._inner, { basePath: '' });
    await this._renderer.load('./js/clear_scene.contract.json');
    this._renderer.show();

    const stage = this._renderer._el;
    stage.style.top = '';
    stage.style.right = '';
    stage.style.bottom = '';
    stage.style.left = '';
    applyScale(stage, null, DESIGN_W, DESIGN_H, true);

    this._resizeHandler = () => applyScale(stage, null, DESIGN_W, DESIGN_H, true);
    window.addEventListener('resize', this._resizeHandler);

    this._wireButtons();
    this._showBannerIfEligible();

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this._wrapper) this._wrapper.style.opacity = '1';
    }));
  }

  _wireButtons() {
    const watchBtn    = this._renderer.getElement('clear-x2-btn-4');
    const continueBtn = this._renderer.getElement('clear-continue-btn-5');
    const showWatchReward = (this.callbacks.getCurrentLevel?.() ?? Infinity) >= 16;

    if (!showWatchReward && watchBtn) {
      watchBtn.style.display = 'none';
    } else {
      watchBtn?.addEventListener('click', async () => {
        if (this._adBusy) return;
        this._adBusy = true;
        watchBtn.style.pointerEvents = 'none';
        const rewarded = await this.callbacks.onWatchAd();
        if (rewarded) {
          if (continueBtn) continueBtn.style.pointerEvents = 'none';
          this._awardCoins(watchBtn, 80);
        } else {
          watchBtn.style.pointerEvents = '';
          this._adBusy = false;
        }
      });
    }

    continueBtn?.addEventListener('click', async () => {
      if (this._adBusy) return;
      this._adBusy = true;
      continueBtn.style.pointerEvents = 'none';
      if (watchBtn) watchBtn.style.pointerEvents = 'none';

      if (await this._shouldShowForcedInterstitial()) {
        try {
          await this.callbacks.onForcedInterstitial?.();
        } catch (e) {
          console.warn('[clear-screen] forced interstitial error:', e);
        }
      }
      this._awardCoins(continueBtn, 40);
    });
  }

  async _shouldShowForcedInterstitial() {
    const lv = this.callbacks.getCurrentLevel?.() ?? 0;
    if (lv < 51 || lv % 3 !== 0) return false;
    const hasNoAds = await this.callbacks.hasNoAds?.();
    return !hasNoAds;
  }

  async _showBannerIfEligible() {
    const lv = this.callbacks.getCurrentLevel?.() ?? 0;
    if (lv < 30) return;

    const wrapper = this._wrapper;
    const hasNoAds = await this.callbacks.hasNoAds?.();
    if (!wrapper || this._wrapper !== wrapper || hasNoAds) return;

    this._bannerRequested = true;
    try {
      await this.callbacks.onShowBanner?.();
    } catch (e) {
      console.warn('[clear-screen] banner show error:', e);
    }

    if (this._wrapper !== wrapper) {
      await this.callbacks.onHideBanner?.();
    }
  }

  _awardCoins(sourceBtn, amount) {
    if (this.coinService)  this.coinService.add(amount);
    if (this.soundService) this.soundService.playCoinFalling();

    const coinDisplayEl = document.querySelector('#coinDisplay');
    this._spawnCoinParticles(sourceBtn, coinDisplayEl || sourceBtn);

    setTimeout(() => this.callbacks.onNextLevel(), 1100);
  }

  // 20개의 코인 → 살짝 아래로 흩어진 후 → 상단 코인 디스플레이로 빨려 올라감
  _spawnCoinParticles(sourceEl, targetEl) {
    const COUNT = 20;
    const host = this._wrapper;
    if (!host) return;

    const hostRect = host.getBoundingClientRect();
    const srcRect  = sourceEl.getBoundingClientRect();
    const dstRect  = targetEl.getBoundingClientRect();

    const sx = (srcRect.left + srcRect.width  / 2) - hostRect.left;
    const sy = (srcRect.top  + srcRect.height / 2) - hostRect.top;
    const dx = (dstRect.left + dstRect.width  / 2) - hostRect.left;
    const dy = (dstRect.top  + dstRect.height / 2) - hostRect.top;

    for (let i = 0; i < COUNT; i++) {
      setTimeout(() => {
        if (!this._wrapper) return;
        const coin = document.createElement('img');
        coin.src = 'assets/coin.webp';
        Object.assign(coin.style, {
          position: 'absolute', width: '26px', height: '26px',
          left: (sx - 13) + 'px', top: (sy - 13) + 'px',
          pointerEvents: 'none', zIndex: '200',
          willChange: 'left, top, width, height, opacity',
        });
        this._wrapper.appendChild(coin);

        // 아래쪽 반원 (각도 0~π) — sin이 양수라 화면 좌표계에서 y가 증가(아래로)
        const angle = Math.random() * Math.PI;
        const dist  = 28 + Math.random() * 40;
        const mx = sx + Math.cos(angle) * dist;
        const my = sy + Math.sin(angle) * dist + 14; // 약간 더 아래로 떨어지는 느낌

        requestAnimationFrame(() => {
          coin.style.transition = 'left 0.24s ease-out, top 0.24s ease-out';
          coin.style.left = (mx - 13) + 'px';
          coin.style.top  = (my - 13) + 'px';

          setTimeout(() => {
            coin.style.transition =
              'left 0.5s cubic-bezier(0.6,0,1,1), top 0.5s cubic-bezier(0.6,0,1,1), ' +
              'width 0.5s ease-in, height 0.5s ease-in, opacity 0.12s 0.4s';
            coin.style.left = (dx - 4) + 'px';
            coin.style.top  = (dy - 4) + 'px';
            coin.style.width = '8px';
            coin.style.height = '8px';
            coin.style.opacity = '0';
            setTimeout(() => coin.remove(), 540);
          }, 270);
        });
      }, i * 35);
    }
  }

  hide() {
    if (!this._wrapper) return;
    if (this._bannerRequested) {
      this.callbacks.onHideBanner?.();
      this._bannerRequested = false;
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    const w = this._wrapper;
    w.style.opacity = '0';
    setTimeout(() => {
      if (w && w.parentNode) w.parentNode.removeChild(w);
    }, 280);
    this._wrapper  = null;
    this._inner    = null;
    this._renderer = null;
  }
}
