import { SceneRenderer }      from '../scene-renderer.js';
import { applyScale }         from '../utils/scaler.js';
import { createScalePopupFrame, openScalePopup, closeScalePopup } from '../utils/popup-manager.js';
import { showToast }          from '../utils/toast.js';
import { getDifficultyColor } from '../utils/difficulty.js';
import { applyIapPriceLabels } from '../utils/iap-price-labels.js';
import { applyEntitlementsToLobbyShop, applyEntitlementsToLobbyMap } from '../utils/lobby-shop-layout.js';
import { ProfileScreen }      from './profile-screen.js';
import { PlayerStatsService } from '../services/player-stats-service.js';

const ROW_HEIGHT = 68;
const TMPL_X = { row: 36, badge: 37, crown: 243, crownImg: 221 };
const TMPL_Y = { row: 120, badge: 133, crown: 141, crownImg: 139 };
const MAP_NORMAL_BG = 'linear-gradient(180deg, #5884fe, #0e4a8c)';
const MAP_HIDDEN_BG = 'url("assets/hidden_image.webp") center center / cover no-repeat, #0e4a8c';
const STAGE_PANEL_BINDING = {
  'start_gamestg':     'level_display',
  'next1-stage-panel': 'next1_stg',
  'next2-stage-panel': 'next2_stg',
  'next3-stage-panel': 'next3_stg',
};
const MAX_LEVEL_REWARDS = [
  { reward_type: 'item', reward_key: 'hint', amount: 2, icon: 'hint.webp' },
  { reward_type: 'item', reward_key: 'hammer', amount: 2, icon: 'hammer.webp' },
  { reward_type: 'item', reward_key: 'timer', amount: 2, icon: 'timer.webp' },
  { reward_type: 'item', reward_key: 'resetboard', amount: 2, icon: 'reset_board.webp' },
  { reward_type: 'item', reward_key: 'time30', amount: 2, icon: 'item_clock.webp' },
];

export class LobbyScreen {
  /**
   * @param {HTMLElement} container
   * @param {{ onStartGame, soundService, coinService, levelManager, leaderboardService }} options
   */
  constructor(container, { onStartGame, onRestartApp, soundService, coinService, levelManager, heartService, adService, itemService, leaderboardService, authService, cloudSaveService, statsService, purchaseService } = {}) {
    this.container = container;
    this._onStartGame = onStartGame;
    this._onRestartApp = onRestartApp;
    this._soundService = soundService;
    this._coinService = coinService;
    this._levelManager = levelManager;
    this._heartService = heartService;
    this._adService = adService;
    this._itemService = itemService;
    this._leaderboardService = leaderboardService;
    this._authService = authService;
    this._cloudSaveService = cloudSaveService;
    this._purchaseService = purchaseService;
    this._boostTime30On = false;

    this._renderer = new SceneRenderer(container, { basePath: '' });
    this._coinUnsub = null;
    this._heartUnsub = null;
    this._heartTimerInterval = null;
    this._leaderboardInterval = null;
    this._lbScrollEl = null;
    this._lbStickyEl = null;
    this._lbStaleEl   = null;
    this._lbOfflineEl = null;
    this._myRankRowEl = null;
    this._onlineHandler = null;
    this._socialLoginWrapper  = null;
    this._socialLoginInner    = null;
    this._socialLoginRenderer = null;
    this._socialLoginSuccessWrapper  = null;
    this._socialLoginSuccessInner    = null;
    this._socialLoginSuccessRenderer = null;
    this._socialLoginLogoutWrapper  = null;
    this._socialLoginLogoutInner    = null;
    this._socialLoginLogoutRenderer = null;
    this._loginBusy = false;
    this._loginBlocker = null;
    this._levelPopupWrapper   = null;
    this._levelPopupInner     = null;
    this._levelPopupRenderer  = null;
    this._maxLevelPopupWrapper   = null;
    this._maxLevelPopupInner     = null;
    this._maxLevelPopupRenderer  = null;
    this._maxLevelCanClose = false;
    this._maxLevelRewarding = false;
    this._buyHeartPopupWrapper  = null;
    this._buyHeartPopupInner    = null;
    this._buyHeartPopupRenderer = null;
    this._resizeHandler = () => this._updateScale();

    this._profileScreen = null;
    this._statsService  = statsService ?? null;
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  async load() {
    // 5개 sub-scene contract 사전 로드 → sceneRegistry 로 등록
    const [mapC, shopC, settingsC, bookC, boardC] = await Promise.all([
      fetch('./js/lobby-map.contract.json').then(r => r.json()),
      fetch('./js/lobby-shop.contract.json').then(r => r.json()),
      fetch('./js/lobby-settings.contract.json').then(r => r.json()),
      fetch('./js/lobby-book.contract.json').then(r => r.json()),
      fetch('./js/lobby-board.contract.json').then(r => r.json()),
    ]);
    this._lobbyShopOriginal = shopC;
    this._lobbyMapOriginal  = mapC;
    const entitlements = await this._authService?.getPreference?.('entitlements');
    this._sceneRegistry = {
      'lobby-map': applyEntitlementsToLobbyMap(mapC, entitlements),
      'lobby-shop': applyEntitlementsToLobbyShop(shopC, entitlements),
      'lobby-settings': settingsC,
      'lobby-book': bookC,
      'lobby-board': boardC,
    };
    this._renderer.setSceneRegistry(this._sceneRegistry);
    await this._renderer.load('./js/lobby.contract.json');
    this._registerEvents();
    this._registerTabMounted();
    await this._loadLevelPopup();
    await this._loadMaxLevelPopup();
    await this._loadBuyHeartPopup();
    await this._loadBuyTimerPopup();
    await this._loadSocialLoginPopup();
    await this._loadSocialLoginSuccessPopup();
    await this._loadSocialLoginLogoutPopup();
    await this._loadShopAdsPopup();
    await this._loadProfileScreen();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  show() {
    // 이미 표시 중인 경우 DOM 정리
    if (this._renderer._el?.parentNode) {
      this._renderer._el.parentNode.removeChild(this._renderer._el);
      this._renderer._el = null;
    }

    // .visible 클래스 → fade-in
    if (!document.getElementById('lobby-visible-css')) {
      const sceneId = this._renderer._contract?.sceneId || 'lobby';
      const s = document.createElement('style');
      s.id = 'lobby-visible-css';
      s.textContent = `#${sceneId}.visible { opacity: 1 !important; }`;
      document.head.appendChild(s);
    }

    this._renderer.show();

    // SceneRenderer의 inset:0 제거 → applyScale 에서 centering 적용
    const stage = this._renderer._el;
    stage.style.top = '';
    stage.style.right = '';
    stage.style.bottom = '';
    stage.style.left = '';

    this._updateScale();

    // 데이터 초기화 (DOM이 생성된 직후)
    this._updateData();

    // 부스트 아이템 배지 초기화 (show() 재진입 시 재생성)
    this._initBoostItemBadge();

    // 코인 변화 리스너 (중복 방지)
    this._coinUnsub?.();
    this._coinUnsub = this._coinService?.onChange?.(() => this._updateCoin());

    // 하트 변화 리스너 + 타이머 인터벌
    this._heartUnsub?.();
    this._heartUnsub = this._heartService?.onChange?.(() => this._updateHearts());
    clearInterval(this._heartTimerInterval);
    this._heartTimerInterval = setInterval(() => this._updateHeartTimer(), 1000);

    // Board 탭 진입 감지는 _registerTabMounted() 의 'tabMounted' 이벤트로 처리됨.

    // 10분마다 리더보드 갱신
    clearInterval(this._leaderboardInterval);
    this._leaderboardInterval = setInterval(() => this._refreshLeaderboard(), 600_000);

    // 오프라인 → 온라인 복귀 시 자동 갱신
    if (this._onlineHandler) window.removeEventListener('online', this._onlineHandler);
    this._onlineHandler = () => this._refreshLeaderboard();
    window.addEventListener('online', this._onlineHandler);

    window.addEventListener('resize', this._resizeHandler);
    setTimeout(() => { void this._maybeOpenMaxLevelPopup(); }, 0);
  }

  hide() {
    window.removeEventListener('resize', this._resizeHandler);
    this._coinUnsub?.();
    this._coinUnsub = null;
    this._heartUnsub?.();
    this._heartUnsub = null;
    clearInterval(this._heartTimerInterval);
    this._heartTimerInterval = null;
    clearInterval(this._leaderboardInterval);
    this._leaderboardInterval = null;
    if (this._onlineHandler) {
      window.removeEventListener('online', this._onlineHandler);
      this._onlineHandler = null;
    }
    this._lbStaleEl?.remove();
    this._lbOfflineEl?.remove();
    this._lbScrollEl = null;
    this._lbStickyEl = null;
    this._lbStaleEl   = null;
    this._lbOfflineEl = null;
    this._myRankRowEl  = null;
    this._closeLevelPopup();
    this._closeMaxLevelPopup({ grantReward: false });
    this._closeBuyHeartPopup();
    this._closeBuyTimerPopup();
    this._closeSocialLoginPopup();
    this._closeSocialLoginSuccessPopup();
    this._closeSocialLoginLogoutPopup();
    this._closeShopAdsPopup();
    this._hideLoginBlocker();
    this._profileScreen?.hide();
    this._renderer.hide();
  }

  // ── Sub-renderer 통합 헬퍼 ───────────────────────────────────────────────
  // nav scene 와 활성 sub-renderer 양쪽에서 stableId / group / bindingKey 검색.

  // 검색 순서: 활성 sub-renderer → popup renderer → nav scene
  // (popup 안의 stableId 가 nav/sub 와 충돌하지 않으므로 순서 무관하나, 가장 자주 쓰이는 sub 를 우선)
  _findElement(stableId) {
    return this._renderer._navHostRenderer?.getElement(stableId)
        ?? this._levelPopupRenderer?.getElement(stableId)
        ?? this._maxLevelPopupRenderer?.getElement(stableId)
        ?? this._buyHeartPopupRenderer?.getElement(stableId)
        ?? this._renderer.getElement(stableId)
        ?? null;
  }

  _findGroup(name) {
    return this._renderer._navHostRenderer?.getGroup(name)
        ?? this._levelPopupRenderer?.getGroup(name)
        ?? this._maxLevelPopupRenderer?.getGroup(name)
        ?? this._buyHeartPopupRenderer?.getGroup(name)
        ?? this._renderer.getGroup(name)
        ?? null;
  }

  _findTextElement(stableId, slotIndex = 0) {
    return this._findElement(stableId)?.querySelector(`.text-${slotIndex}`) ?? null;
  }

  _updateBoth(data) {
    this._renderer.update(data);
    this._renderer._navHostRenderer?.update(data);
    this._levelPopupRenderer?.update(data);
    this._maxLevelPopupRenderer?.update(data);
    this._buyHeartPopupRenderer?.update(data);
  }

  // ── Events (load() 후 1회만 등록) ───────────────────────────────────────

  _registerEvents() {
    // nav scene (팝업 포함) 의 이벤트 등록
    this._registerEventsOn(this._renderer);
  }

  // sub-renderer 가 마운트될 때마다 동일 이벤트를 해당 sub-renderer 에도 등록.
  // 이벤트 이름이 sub-scene 의 layer 에 정의된 경우에만 fire 되므로 중복 등록은 안전.
  _registerEventsOn(target) {
    target.on('start_game',            () => this._openLevelPopup());
    target.on('start_play',            () => this._startGameWithFade());
    target.on('toggle_boostitem_timer',() => this._handleToggleBoostTime30());
    target.on('close_level_popup',() => this._closeLevelPopup());
    target.on('buy_heart',        () => this._openBuyHeartPopup());
    target.on('close_heart_popup',() => this._closeBuyHeartPopup());
    target.on('adrefill_heart',   () => this._handleAdRefill());
    target.on('refill_heart',     () => this._handleRefillHeart());
    target.on('ToggleBgm',     () => this._handleToggleBgm());
    target.on('ToggleSFX',     () => this._handleToggleSfx());
    target.on('ToggleHaptic',  () => this._handleToggleHaptic());
    // map 탭의 코인 구매 버튼 → shop 탭 이동
    target.on('buy_coin', () => this._renderer.switchTab('t1'));
    // shop 탭의 IAP 상품 버튼 (추후 IAP 연결)
    for (let i = 1; i <= 6; i++) {
      target.on(`buy_coin${i}`, () => this._handlePurchase(`buy_coin${i}`, 'lobby-shop'));
    }
    target.on('buy_noadsbundle1', () => this._handlePurchase('buy_noadsbundle1', 'lobby-shop'));
    target.on('buy_noads',        () => this._handlePurchase('buy_noads', 'lobby-shop'));
    target.on('buy_special_offer', () => this._handlePurchase('buy_special_offer', 'popup_shop_discount'));
    target.on('buy_golden_offer',  () => this._handlePurchase('buy_golden_offer', 'popup_shop'));
    target.on('openSupportsite',  () => console.log('[lobby] openSupportsite'));
    target.on('openloginsdk',     () => this._openSocialLoginPopup());
    target.on('goto_profile',     () => this._profileScreen?.open());
    target.on('popup_noads',      () => this._openShopAdsPopup());
  }

  _registerTabMounted() {
    // scene-renderer.js 는 'tabMounted' 이벤트를 emit 하지 않으므로
    // switchTab 을 wrap 해서 sub-renderer mount 직후 후처리를 수행한다.
    // (sceneRegistry 사용 시 mountMatched 는 동기 실행되어 _navHostRenderer 가 즉시 채워진다.)
    const orig = this._renderer.switchTab.bind(this._renderer);
    this._renderer.switchTab = (tabId) => {
      orig(tabId);
      const sub = this._renderer._navHostRenderer;
      if (sub) this._registerEventsOn(sub);
      this._updateData();
      this._refreshIapPrices();
      if (tabId === 't4') this._refreshLeaderboard();
    };
  }

  // ── Boost Item 핸들러 ────────────────────────────────────────────────────

  _handleToggleBoostTime30() {
    const count = this._itemService?.getCount('time30') ?? 0;
    if (!this._boostTime30On && count <= 0) {
      this._openBuyTimerPopup();
      return;
    }

    this._boostTime30On = !this._boostTime30On;
    if (this._boostItemInner) {
      this._boostItemInner.style.background = this._boostTime30On
        ? SceneRenderer.utils.depthGradientCss('#66bb6a', 51)
        : this._boostItemOrigBg;
    }
    if (this._boostTimeBadge) {
      if (this._boostTime30On) {
        this._boostTimeBadge.style.background = '#27ae60';
        this._boostTimeBadge.textContent = '✓';
      } else {
        this._refreshBoostBadge();
      }
    }
  }

  _refreshBoostBadge() {
    if (!this._boostTimeBadge) return;
    const count = this._itemService?.getCount('time30') ?? 0;
    if (count <= 0) {
      this._boostTimeBadge.style.background = '#27ae60';
      this._boostTimeBadge.textContent = '+';
    } else {
      this._boostTimeBadge.style.background = '#e74c3c';
      this._boostTimeBadge.textContent = String(count);
    }
  }

  _resetBoostTime30Ui() {
    this._boostTime30On = false;
    if (this._boostItemInner) {
      this._boostItemInner.style.background = this._boostItemOrigBg;
    }
    this._refreshBoostBadge();
  }

  // ── Popup Helpers (PopupManager scale-spring 애니메이션 매칭) ────────────
  // duration 300ms / easing cubic-bezier(0.34,1.56,0.64,1) / scale 0↔1
  // wrapper(dim) + inner(scale animation) + stage(applyScale 적용) 3계층 구조.

  async _createContractPopup(contractPath, eventMap = {}, dimOpacity = 0.8) {
    const { wrapper, inner } = createScalePopupFrame({ dimOpacity });
    const renderer = new SceneRenderer(inner, { basePath: '' });
    await renderer.load(contractPath);
    renderer.show();

    const stage = renderer._el;
    stage.style.right = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    Object.entries(eventMap).forEach(([eventName, handler]) => {
      renderer.on(eventName, handler);
    });

    window.addEventListener('resize', () => {
      if (renderer) applyScale(stage, null, 390, 844, true);
    });

    return { wrapper, inner, renderer };
  }

  // ── Buy Timer Popup ───────────────────────────────────────────────────────

  async _loadBuyTimerPopup() {
    const { wrapper, inner } = createScalePopupFrame();
    this._buyTimerWrapper = wrapper;
    this._buyTimerInner   = inner;

    const r = new SceneRenderer(inner, { basePath: '' });
    await r.load('./js/buy_timer_popup.contract.json');
    r.show();

    const stage = r._el;
    // position:absolute 유지 (SceneRenderer 기본값)
    // right/bottom 초기화 후 applyScale(center=true)가 left:50%;top:50% 설정
    stage.style.right = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    r.on('close_buytimer_popup', () => this._closeBuyTimerPopup());
    r.on('buy_timer',            () => this._handleBuyTimer());
    this._buyTimerRenderer = r;

    window.addEventListener('resize', () => {
      if (this._buyTimerRenderer) applyScale(stage, null, 390, 844, true);
    });
  }

  _openBuyTimerPopup() {
    if (!this._buyTimerWrapper) return;
    openScalePopup(this._buyTimerWrapper, this._buyTimerInner);
  }

  _closeBuyTimerPopup(duration) {
    if (!this._buyTimerWrapper) return;
    closeScalePopup(this._buyTimerWrapper, this._buyTimerInner, duration);
  }

  // ── Social Login Popup ────────────────────────────────────────────────────

  async _loadSocialLoginPopup() {
    const popup = await this._createContractPopup('./js/sociallogin_popup.contract.json', {
      close_sociallogin_popup: () => this._closeSocialLoginPopup(),
      'Login.Google':   () => this._handleSocialLogin('google'),
      'Login.Facebook': () => this._handleSocialLogin('facebook'),
      'Login.Apple':    () => this._handleSocialLogin('apple'),
    });
    this._socialLoginWrapper = popup.wrapper;
    this._socialLoginInner = popup.inner;
    this._socialLoginRenderer = popup.renderer;
  }

  async _loadSocialLoginSuccessPopup() {
    const popup = await this._createContractPopup('./js/sociallogin_success.contract.json', {
      continue_login: () => this._handleContinueLogin(),
    });
    this._socialLoginSuccessWrapper = popup.wrapper;
    this._socialLoginSuccessInner = popup.inner;
    this._socialLoginSuccessRenderer = popup.renderer;
  }

  async _loadSocialLoginLogoutPopup() {
    const popup = await this._createContractPopup('./js/sociallogin_logout.contract.json', {
      cancle_signout: () => this._handleCancelSignout(),
      signout:        () => this._handleSignout(),
    });
    this._socialLoginLogoutWrapper = popup.wrapper;
    this._socialLoginLogoutInner = popup.inner;
    this._socialLoginLogoutRenderer = popup.renderer;
  }

  // ── Shop Ads Popup (no_ads / no_ads_bundle 전용) ──────────────────────────

  async _loadShopAdsPopup() {
    const popup = await this._createContractPopup('./js/popup_shop_ads.contract.json', {
      close_shop_popup: () => this._closeShopAdsPopup(),
      buy_noads:        () => this._handlePurchase('buy_noads',        'popup_shop_ads'),
      buy_noadsbundle1: () => this._handlePurchase('buy_noadsbundle1', 'popup_shop_ads'),
    });
    this._shopAdsWrapper  = popup.wrapper;
    this._shopAdsInner    = popup.inner;
    this._shopAdsRenderer = popup.renderer;
    await applyIapPriceLabels(popup.renderer, this._purchaseService, 'popup_shop_ads');
  }

  _openShopAdsPopup() {
    if (!this._shopAdsWrapper) return;
    openScalePopup(this._shopAdsWrapper, this._shopAdsInner);
  }

  _closeShopAdsPopup() {
    if (!this._shopAdsWrapper) return;
    closeScalePopup(this._shopAdsWrapper, this._shopAdsInner);
  }

  async _loadProfileScreen() {
    this._statsService ??= new PlayerStatsService(this._authService, this._leaderboardService);
    this._profileScreen = new ProfileScreen(document.body, {
      authService:         this._authService,
      leaderboardService:  this._leaderboardService,
      statsService:        this._statsService,
      levelManager:        this._levelManager,
      onSave:              () => this._updateProfile(),
    });
    await this._profileScreen.load();
  }

  _openSocialLoginPopup() {
    if (!this._socialLoginWrapper) return;
    openScalePopup(this._socialLoginWrapper, this._socialLoginInner);
    this._updateSocialLoginText();
  }

  _closeSocialLoginPopup() {
    if (!this._socialLoginWrapper) return;
    closeScalePopup(this._socialLoginWrapper, this._socialLoginInner);
  }

  _openSocialLoginSuccessPopup() {
    if (!this._socialLoginSuccessWrapper) return;
    openScalePopup(this._socialLoginSuccessWrapper, this._socialLoginSuccessInner);
  }

  _closeSocialLoginSuccessPopup() {
    if (!this._socialLoginSuccessWrapper) return;
    closeScalePopup(this._socialLoginSuccessWrapper, this._socialLoginSuccessInner);
  }

  _openSocialLoginLogoutPopup() {
    if (!this._socialLoginLogoutWrapper) return;
    openScalePopup(this._socialLoginLogoutWrapper, this._socialLoginLogoutInner);
  }

  _closeSocialLoginLogoutPopup() {
    if (!this._socialLoginLogoutWrapper) return;
    closeScalePopup(this._socialLoginLogoutWrapper, this._socialLoginLogoutInner);
  }

  async _handlePurchase(clickEvent, sceneName) {
    const purchased = await this._purchaseService?.purchaseByEvent?.(clickEvent, { sceneName });
    if (!purchased) return;
    this._updateData();
    this._refreshIapPrices();
    if (clickEvent === 'buy_noads' || clickEvent === 'buy_noadsbundle1') {
      await this._refreshLobbyShopLayout();
      await this._refreshLobbyMapLayout();
      this._closeShopAdsPopup();
    }
    await this._cloudSaveService?.syncIfNeeded?.();
  }

  async _refreshLobbyShopLayout() {
    if (!this._lobbyShopOriginal || !this._sceneRegistry) return;
    const entitlements = await this._authService?.getPreference?.('entitlements');
    const next = applyEntitlementsToLobbyShop(this._lobbyShopOriginal, entitlements);
    this._sceneRegistry['lobby-shop'] = next;
    if (this._renderer._activeTab === 't1' && this._renderer._navHostRenderer) {
      await this._renderer._navHostRenderer.reload(next);
      await this._refreshIapPrices();
    }
  }

  async _refreshLobbyMapLayout() {
    if (!this._lobbyMapOriginal || !this._sceneRegistry) return;
    const entitlements = await this._authService?.getPreference?.('entitlements');
    const next = applyEntitlementsToLobbyMap(this._lobbyMapOriginal, entitlements);
    this._sceneRegistry['lobby-map'] = next;
    // map 탭이 현재 활성이면 즉시 reload — 다른 탭이면 다음 진입 시 registry 에서 자동 반영.
    const mapTab = this._renderer._contract?.tabs?.find?.(t => t.sceneName === 'lobby-map')?.id;
    if (mapTab && this._renderer._activeTab === mapTab && this._renderer._navHostRenderer) {
      await this._renderer._navHostRenderer.reload(next);
    }
  }

  async _refreshIapPrices() {
    const activeRenderer = this._renderer._navHostRenderer;
    if (this._renderer._activeTab === 't1') {
      await applyIapPriceLabels(activeRenderer, this._purchaseService, 'lobby-shop');
    }
  }

  _showLoginBlocker() {
    if (!this._loginBlocker) {
      const blocker = document.createElement('div');
      blocker.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2600',
        'display:none',
        'background:rgba(0,0,0,0.72)',
        'pointer-events:auto',
        'touch-action:none',
        'cursor:wait',
      ].join(';');
      blocker.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
      document.body.appendChild(blocker);
      this._loginBlocker = blocker;
    }
    this._loginBlocker.style.display = 'block';
  }

  _hideLoginBlocker() {
    this._loginBusy = false;
    if (this._loginBlocker) this._loginBlocker.style.display = 'none';
  }

  async _handleSocialLogin(provider) {
    if (this._loginBusy) return;
    if (provider === 'google' && await this._authService?.isLoggedIn?.()) {
      this._closeSocialLoginPopup();
      this._openSocialLoginLogoutPopup();
      return;
    }

    this._loginBusy = true;
    this._showLoginBlocker();
    let result = null;
    try {
      await this._cloudSaveService?.rememberLocalBeforeSocialLogin?.();
      if (provider === 'google')   result = await this._authService?.loginWithGoogle();
      if (provider === 'facebook') result = await this._authService?.loginWithFacebook();
      if (provider === 'apple')    result = await this._authService?.loginWithApple();
    } catch (e) {
      console.warn('[lobby] social login error:', provider, e);
      const msg = e?.message || e?.code || String(e);
      this._hideLoginBlocker();
      this._showToast(`로그인 실패: ${msg}`);
      return;
    }
    if (result) {
      if (this._leaderboardService) this._leaderboardService._cache = null;
      let postLoginError = null;
      try {
        await this._authService?.initIdentity?.();
        await this._purchaseService?.syncIdentity?.();
        const restored = await this._cloudSaveService?.restoreIfLoggedIn?.();
        if (!restored) await this._cloudSaveService?.uploadNow?.();
        const displayName = result?.displayName;
        if (displayName) {
          await this._authService?.applySocialDisplayName?.(displayName);
          this._cloudSaveService?.markDirty?.();
          await this._cloudSaveService?.uploadNow?.();
        }
        await this._updateProfile();
        await this._refreshLeaderboard();
      } catch (e) {
        postLoginError = e;
        console.warn('[lobby] post-login sync error:', provider, e);
        try {
          await this._updateProfile();
        } catch {}
      }
      await this._updateSocialLoginText();
      this._closeSocialLoginPopup();
      this._hideLoginBlocker();
      this._openSocialLoginSuccessPopup();
      if (postLoginError) {
        this._showToast('Login succeeded. Data sync will retry.');
      }
    } else {
      this._hideLoginBlocker();
    }
  }

  async _updateSocialLoginText() {
    if (!this._socialLoginRenderer || !this._authService) return;
    const loggedIn = await this._authService.isLoggedIn();
    this._socialLoginRenderer.update({
      'Login.google': loggedIn ? 'Sign out from Google' : 'Sign in with Google',
    });
  }

  async _handleContinueLogin() {
    await this._cloudSaveService?.syncIfNeeded?.();
    this._closeSocialLoginSuccessPopup();
    this._onRestartApp?.();
  }

  _handleCancelSignout() {
    this._closeSocialLoginLogoutPopup();
  }

  async _handleSignout() {
    await this._cloudSaveService?.uploadNow?.();
    await this._authService?.logout?.();
    await this._cloudSaveService?.resetLocalAfterSocialLogout?.();
    await this._purchaseService?.syncIdentity?.();
    this._closeSocialLoginLogoutPopup();
    this._updateCoin();
    this._updateStages();
    this._updateHearts();
    await this._updateProfile();
    await this._refreshLeaderboard();
  }

  _showToast(message) {
    showToast(message, {
      fontSize: '14px',
      padding: '16px 24px',
      duration: 4000,
      fadeMs: 250,
      maxWidth: '80vw',
      wordBreak: 'break-all',
    });
  }

  _handleBuyTimer() {
    if (!this._coinService?.spend(900)) {
      this._closeBuyTimerPopup(0);
      this._closeLevelPopup(0);
      this._renderer.switchTab('t1');
      return;
    }
    this._itemService?.add('time30', 3);
    this._closeBuyTimerPopup();
    this._refreshBoostBadge();
  }

  _initBoostItemBadge() {
    const wrap  = this._findElement('item-plustime');
    const inner = wrap?.firstElementChild;
    if (!inner) return;

    this._boostItemInner  = inner;
    this._boostItemOrigBg = inner.style.background;

    // 기존 배지 제거 후 재생성
    this._boostTimeBadge?.remove();
    const b = document.createElement('div');
    b.style.cssText = [
      'position:absolute', 'top:-5px', 'right:-5px',
      'min-width:20px', 'height:20px',
      'background:#e74c3c', 'border-radius:10px',
      'border:2px solid #fff',
      'color:#fff', 'font-size:11px', 'font-weight:900',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:0 3px',
      'pointer-events:none', 'z-index:20',
    ].join(';');
    const count = this._itemService?.getCount('time30') ?? 0;
    if (count <= 0) {
      b.style.background = '#27ae60';
      b.textContent = '+';
    } else {
      b.textContent = String(count);
    }
    inner.appendChild(b);
    this._boostTimeBadge = b;
  }

  // ── Settings 핸들러 ───────────────────────────────────────────────────────

  _handleToggleBgm() {
    if (!this._soundService) return;
    this._soundService.toggleBgm();
    this._updateSettingBtn('price-badge-1', !this._soundService.isBgmMuted());
  }

  _handleToggleSfx() {
    if (!this._soundService) return;
    this._soundService.toggleSfx();
    this._updateSettingBtn('sfx-button-17', !this._soundService.isSfxMuted());
  }

  _handleToggleHaptic() {
    if (!this._soundService) return;
    this._soundService.toggleHaptic();
    this._updateSettingBtn('haptic-button-18', this._soundService.isHapticEnabled());
  }

  _updateSettingBtn(stableId, isOn) {
    const span = this._findTextElement(stableId, 0);
    if (span) span.textContent = isOn ? 'ON' : 'OFF';
  }

  _updateSettingButtons() {
    if (!this._soundService) return;
    this._updateSettingBtn('price-badge-1', !this._soundService.isBgmMuted());
    this._updateSettingBtn('sfx-button-17',  !this._soundService.isSfxMuted());
    this._updateSettingBtn('haptic-button-18', this._soundService.isHapticEnabled());
  }

  // ── Data 업데이트 ─────────────────────────────────────────────────────────

  _updateData() {
    this._updateCoin();
    this._updateStages();
    this._updateSettingButtons();
    this._updateHearts();
    this._updateProfile();
  }

  async _updateProfile() {
    if (!this._statsService || !this._authService) return;
    const [name, code, uid] = await Promise.all([
      this._statsService.getName(),
      this._statsService.getFlag(),
      this._authService.getSupportUid(),
    ]);
    const bindings = {
      'player.name':  name,
      'player.flags': `assets/ctry/${code}.webp`,
      'player.uid':   uid,
    };
    this._renderer._navHostRenderer?.update(bindings);
    this._renderer.update(bindings);
  }

  _updateCoin() {
    if (!this._coinService) return;
    const coins = this._coinService.getCoins();
    const str = String(coins);
    // Map 탭 코인 카운터
    const el1 = this._findTextElement('coin-counter-36', 0);
    if (el1) el1.textContent = str;
    // Shop 탭 코인 카운터
    const el2 = this._findTextElement('coin-counter-2', 0);
    if (el2) el2.textContent = str;
  }

  _updateHearts() {
    if (!this._heartService) return;
    const count = this._heartService.getCount();
    this._updateBoth({ heart_count: String(count) });
    this._updateHeartTimer();
  }

  _updateHeartTimer() {
    if (!this._heartService) return;
    const ms = this._heartService.getNextRegenMs();
    let text;
    if (ms <= 0) {
      text = 'FULL';
    } else {
      const totalSec = Math.ceil(ms / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      text = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    this._updateBoth({ heart_timer: text });
  }

  _updateStages() {
    if (!this._levelManager) return;
    const idx = this._levelManager.currentIndex;
    const total = this._levelManager.getTotalLevels();
    const openCount = this._levelManager.getOpenLevelCount?.() ?? total;
    const isHidden = !!this._levelManager.isHiddenLeague?.();

    this._updateBoth({ Level: isHidden ? 'Hidden' : 'Level' });
    this._updateMapBackground(isHidden);
    this._setHiddenStageAura(isHidden);
    this._setElementVisible('level-path-1', !isHidden);
    this._soundService?.setHiddenLeagueBgm?.(isHidden);

    if (isHidden) {
      this._updateBoth({ level_display: String(this._levelManager.getHiddenLeagueStageNumber?.() ?? 1) });
      const level = this._levelManager.getCurrentLevel?.();
      if (level) this._applyStagePanelColor('start_gamestg', level);
      ['next1-stage-panel', 'next2-stage-panel', 'next3-stage-panel'].forEach(id => this._setElementVisible(id, false));
      ['nav-item-locked-5', 'stage-lock-panel-7', 'stage-lock-panel-4'].forEach(id => this._setElementVisible(id, false));
      return;
    }

    // 현재 스테이지 (항상 표시)
    this._applyStagePanel('start_gamestg', idx);

    // 예정 스테이지 3개 — 잠금 오버레이는 스테이지 위에 항상 함께 표시됨 (반투명)
    const panels = [
      { stableId: 'next1-stage-panel', lockId: 'nav-item-locked-5',  offset: 1 },
      { stableId: 'next2-stage-panel', lockId: 'stage-lock-panel-7', offset: 2 },
      { stableId: 'next3-stage-panel', lockId: 'stage-lock-panel-4', offset: 3 },
    ];

    for (const p of panels) {
      const levelIdx = idx + p.offset;
      const hasLevel = levelIdx < openCount;
      // 레벨이 있으면 스테이지 패널 + 잠금 오버레이 둘 다 표시
      this._setElementVisible(p.stableId, hasLevel);
      this._setElementVisible(p.lockId, hasLevel);
      if (hasLevel) this._applyStagePanel(p.stableId, levelIdx);
    }
  }

  _applyStagePanel(stableId, levelIndex) {
    const levels = this._levelManager?.levels;
    if (!levels) return;
    const level = levels[levelIndex % levels.length]; // 전체 완료 시 순환
    if (!level) return;

    const bindingKey = STAGE_PANEL_BINDING[stableId];
    if (bindingKey) this._updateBoth({ [bindingKey]: String(level.level) });

    this._applyStagePanelColor(stableId, level);
  }

  _applyStagePanelColor(stableId, level) {
    const inner = this._findElement(stableId)?.firstElementChild;
    if (inner) {
      inner.style.background = SceneRenderer.utils.depthGradientCss(
        getDifficultyColor(level), 51
      );
    }
  }

  _setHiddenStageAura(enabled) {
    const el = this._findElement('start_gamestg');
    if (!el) return;
    this._removeAmbientAura(el);
    if (!enabled) {
      return;
    }
    const effect = this._getStartStageAuraEffect() ?? SceneRenderer.utils.normalizeParticleEffect({
      particleEffect: { enabled: true, presetId: 'ambient-sparkle-aura' },
    });
    SceneRenderer.utils.applyAmbientSparkleAura(el.firstElementChild ?? el, effect);
  }

  _getStartStageAuraEffect() {
    const contract = this._renderer._navHostRenderer?._contract;
    const layer = contract?.layers?.find?.(item => item?.stableId === 'start_gamestg');
    const effect = SceneRenderer.utils.findEffect?.(layer?.effects, 'particle-effect');
    if (effect?.source?.template === 'ambient-aura') return effect;
    return null;
  }

  _updateMapBackground(isHidden) {
    const panel = this._renderer._navHostRenderer?._el;
    if (!panel || this._renderer._activeTab !== 't0') return;
    panel.style.background = isHidden ? MAP_HIDDEN_BG : MAP_NORMAL_BG;
    panel.style.backgroundSize = isHidden ? 'cover' : '';
    panel.style.backgroundPosition = isHidden ? 'center center' : '';
    panel.style.backgroundRepeat = isHidden ? 'no-repeat' : '';
  }

  _removeAmbientAura(root) {
    root.querySelectorAll?.('.ui-ambient-aura').forEach(el => el.remove());
    if (root.classList?.contains('ui-ambient-aura')) root.remove();
  }

  _setElementVisible(stableId, visible) {
    const el = this._findElement(stableId);
    if (el) el.style.display = visible ? '' : 'none';
  }

  // ── Level / Buy Heart Popup (별도 .scene/.contract 분리됨) ─────────────────
  // buy_timer_popup / sociallogin_popup 과 동일한 wrapper-renderer 패턴 사용.

  async _loadLevelPopup() {
    const { wrapper, inner } = createScalePopupFrame();
    this._levelPopupWrapper = wrapper;
    this._levelPopupInner   = inner;

    const r = new SceneRenderer(inner, { basePath: '' });
    await r.load('./js/level_popup.contract.json');
    r.show();
    const stage = r._el;
    stage.style.right = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    this._registerEventsOn(r);
    this._levelPopupRenderer = r;

    window.addEventListener('resize', () => {
      if (this._levelPopupRenderer) applyScale(stage, null, 390, 844, true);
    });
  }

  async _loadMaxLevelPopup() {
    const { wrapper, inner } = createScalePopupFrame({ zIndex: 2300 });
    this._maxLevelPopupWrapper = wrapper;
    this._maxLevelPopupInner   = inner;

    const r = new SceneRenderer(inner, { basePath: '' });
    await r.load('./js/max_level.contract.json');
    r.show();
    const stage = r._el;
    stage.style.right = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    this._maxLevelPopupRenderer = r;
    wrapper.addEventListener('pointerdown', () => {
      if (this._maxLevelCanClose) this._closeMaxLevelPopup();
    });

    window.addEventListener('resize', () => {
      if (this._maxLevelPopupRenderer) applyScale(stage, null, 390, 844, true);
    });
  }

  async _loadBuyHeartPopup() {
    const { wrapper, inner } = createScalePopupFrame();
    this._buyHeartPopupWrapper = wrapper;
    this._buyHeartPopupInner   = inner;

    const r = new SceneRenderer(inner, { basePath: '' });
    await r.load('./js/buy_heart_popup.contract.json');
    r.show();
    const stage = r._el;
    stage.style.right = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    this._registerEventsOn(r);
    this._buyHeartPopupRenderer = r;

    window.addEventListener('resize', () => {
      if (this._buyHeartPopupRenderer) applyScale(stage, null, 390, 844, true);
    });
  }

  _openLevelPopup() {
    if (!this._levelPopupWrapper) return;

    if (this._levelManager) {
      const level = this._levelManager.getCurrentLevel?.();
      if (level) {
        const grade = level.difficulty?.grade ?? '';
        const isHidden = !!this._levelManager.isHiddenLeague?.();
        this._updateBoth({
          level_display: isHidden
            ? String(this._levelManager.getHiddenLeagueStageNumber?.() ?? 1)
            : String(level.level),
          difficult: grade,
        });
        const inner = this._findElement('difficult')?.firstElementChild;
        if (inner) {
          inner.style.background = SceneRenderer.utils.depthGradientCss(
            getDifficultyColor(level), 51
          );
        }
      }
    }

    // 선택 상태 초기화 + 배지 수량 갱신
    this._boostTime30On = false;
    if (this._boostItemInner) {
      this._boostItemInner.style.background = this._boostItemOrigBg;
    }
    this._refreshBoostBadge();

    openScalePopup(this._levelPopupWrapper, this._levelPopupInner);
  }

  _closeLevelPopup(duration) {
    if (!this._levelPopupWrapper) return;
    closeScalePopup(this._levelPopupWrapper, this._levelPopupInner, duration);
  }

  async _maybeOpenMaxLevelPopup() {
    if (!this._levelManager?.isHiddenLeague?.() || !this._maxLevelPopupWrapper) return;
    const season = this._levelManager.getHiddenLeagueSeasonId();
    const seen = await this._authService?.getPreference?.('max_level_reward_seen_seasons') ?? [];
    if (Array.isArray(seen) && seen.includes(season)) return;
    this._openMaxLevelPopup();
  }

  _openMaxLevelPopup() {
    if (!this._maxLevelPopupWrapper) return;
    this._maxLevelCanClose = false;
    this._updateBoth({ stage_max: String(this._levelManager?.getMaxReleasedStageNumber?.() ?? '') });
    openScalePopup(this._maxLevelPopupWrapper, this._maxLevelPopupInner);
    setTimeout(() => { this._maxLevelCanClose = true; }, 2000);
  }

  async _closeMaxLevelPopup({ grantReward = true } = {}) {
    if (!this._maxLevelPopupWrapper || this._maxLevelPopupWrapper.style.display === 'none') return;
    if (this._maxLevelRewarding) return;
    this._maxLevelRewarding = true;
    this._maxLevelCanClose = false;

    if (grantReward) {
      const season = this._levelManager?.getHiddenLeagueSeasonId?.();
      const seen = await this._authService?.getPreference?.('max_level_reward_seen_seasons') ?? [];
      const seenList = Array.isArray(seen) ? seen : [];
      if (season && !seenList.includes(season)) {
        await this._authService?.setPreference?.('max_level_reward_seen_seasons', [...seenList, season]);
        this._grantPopupRewards(MAX_LEVEL_REWARDS);
      }
    }

    closeScalePopup(this._maxLevelPopupWrapper, this._maxLevelPopupInner);
    setTimeout(() => { this._maxLevelRewarding = false; }, 350);
  }

  // ── Buy Heart Popup ───────────────────────────────────────────────────────

  _openBuyHeartPopup()  {
    if (this._heartService?.isFull()) return;
    if (!this._buyHeartPopupWrapper) return;
    openScalePopup(this._buyHeartPopupWrapper, this._buyHeartPopupInner);
  }
  _closeBuyHeartPopup() {
    if (!this._buyHeartPopupWrapper) return;
    closeScalePopup(this._buyHeartPopupWrapper, this._buyHeartPopupInner);
  }

  async _handleAdRefill() {
    if (this._adRefillBusy) return;
    if (this._heartService?.isFull()) return;
    this._adRefillBusy = true;
    try {
      const rewarded = await this._adService?.showRewardedAd('heart');
      if (!rewarded) return;
      this._heartService?.restore();
      this._closeBuyHeartPopup();
    } finally {
      this._adRefillBusy = false;
    }
  }

  _handleRefillHeart() {
    if (this._heartService?.isFull()) return;
    const spent = this._coinService?.spend(900);
    if (!spent) {
      this._closeBuyHeartPopup();
      this._renderer.switchTab('t1');
      return;
    }
    this._heartService?.refillFull();
    this._closeBuyHeartPopup();
  }

  _startGameWithFade() {
    const useBoost = this._boostTime30On;
    if (useBoost) {
      this._itemService?.use('time30');
    }
    this._resetBoostTime30Ui();

    // 암전
    const fade = document.createElement('div');
    fade.style.cssText =
      'position:fixed;inset:0;background:#000;opacity:0;transition:opacity 0.35s ease;z-index:9999;pointer-events:none;';
    document.body.appendChild(fade);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fade.style.opacity = '1';
    }));
    // 암전 완료 후 게임 시작
    setTimeout(() => {
      this._onStartGame?.({ boostTime30: useBoost });
      // 게임 화면이 렌더링된 뒤 서서히 밝아짐
      setTimeout(() => {
        fade.style.opacity = '0';
        setTimeout(() => fade.remove(), 350);
      }, 50);
    }, 350);
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────

  async _refreshLeaderboard() {
    const svc = this._leaderboardService;
    if (!svc) return;

    // 캐시가 있으면 즉시 렌더링 → 템플릿 flicker 없음
    const cached = svc.cachedEntries;
    if (cached?.length) {
      await this._renderLeaderboard(cached, await svc.getMyRank(cached));
    } else {
      // 캐시 없음: 템플릿만 먼저 숨기기 (빈 화면이 깜빡임보다 낫다)
      const g1 = this._findGroup('Ranking_Sample');
      const g2 = this._findGroup('Group');
      if (g1) g1.style.display = 'none';
      if (g2) g2.style.display = 'none';
    }

    // 업로드 후 최신 데이터 fetch (캐시 TTL 내면 네트워크 미발생)
    await this._cloudSaveService?.uploadNow?.();
    const result = await svc.getLeaderboard();

    if (result.entries?.length) {
      await this._renderLeaderboard(result.entries, await svc.getMyRank(result.entries));
      this._renderStaleLabel(result.stale ? result.lastUpdated : null);
    } else if (result.empty) {
      this._renderEmptyLeaderboard();
    } else if (result.offline) {
      this._renderOfflineEmpty(result.reason);
    }
  }

  async _renderLeaderboard(entries, myRank) {
    const svc = this._leaderboardService;
    if (!svc) return;

    // Ranking_Sample 원본 그룹 숨기기 (데이터 유무 관계없이)
    const grp1 = this._findGroup('Ranking_Sample');
    const grp2 = this._findGroup('Group');
    if (grp1) grp1.style.display = 'none';
    if (grp2) grp2.style.display = 'none';
    if (!entries.length) return;

    // 데이터가 들어왔으니 오프라인 안내 화면은 제거
    this._lbOfflineEl?.remove();
    this._lbOfflineEl = null;

    // 기존 스크롤/sticky 제거
    this._lbScrollEl?.remove();
    this._lbStickyEl?.row?.remove();
    this._lbStickyEl?.badge?.remove();
    this._lbStickyEl?.crown?.remove();
    this._lbStickyEl?.crownImg?.remove();
    this._lbScrollEl = null;
    this._lbStickyEl = null;
    this._myRankRowEl = null;

    // 템플릿 요소
    const tmplRow    = this._findElement('rank-row-3');
    const tmplBadge  = this._findElement('rank-badge-gold-4');
    const tmplCrown  = this._findElement('royal-crown-11');
    const tmplCrownImg = this._findElement('crown-4');
    if (!tmplRow || !tmplBadge) return;

    // Board sub-renderer 의 _el 에 스크롤 컨테이너 주입.
    // 활성 탭이 t4 가 아니면 sub-renderer 가 board 가 아닐 수 있으므로 가드.
    if (this._renderer._activeTab !== 't4') return;
    const panel = this._renderer._navHostRenderer?._el;
    if (!panel) return;

    const scrollEl = document.createElement('div');
    scrollEl.style.cssText = [
      'position:absolute', `left:${TMPL_X.row}px`, `top:${TMPL_Y.row}px`,
      `width:320px`, 'height:560px',
      'overflow-y:auto', 'overflow-x:hidden',
      '-webkit-overflow-scrolling:touch',
      'z-index:10', 'scrollbar-width:none',
    ].join(';');
    panel.appendChild(scrollEl);
    this._lbScrollEl = scrollEl;

    const innerEl = document.createElement('div');
    innerEl.style.cssText = `position:relative;height:${entries.length * ROW_HEIGHT}px;`;
    scrollEl.appendChild(innerEl);

    // 각 랭킹 행 생성
    const myId = await svc.getUserId();
    entries.forEach((entry, i) => {
      const isMe = entry.id === myId;
      const { rowEl, badgeEl, crownEl, crownImgEl } = this._buildRankRow(
        tmplRow, tmplBadge, tmplCrown, tmplCrownImg, entry, i + 1, isMe, i
      );
      innerEl.appendChild(rowEl);
      innerEl.appendChild(badgeEl);
      if (crownEl)    innerEl.appendChild(crownEl);
      if (crownImgEl) innerEl.appendChild(crownImgEl);
      if (isMe) this._myRankRowEl = rowEl;
    });

    // Sticky 내 랭킹 패널 생성
    const myEntry = myRank ? entries[myRank - 1] : null;
    await this._buildStickyMyRank(panel, tmplRow, tmplBadge, tmplCrown, tmplCrownImg, myRank, myEntry);

    // 스크롤 이벤트로 visibility 체크
    scrollEl.addEventListener('scroll', () => this._checkMyRankVisibility(scrollEl));
    this._checkMyRankVisibility(scrollEl);
  }

  // 랭크에 따라 뱃지를 금/은/동으로 다시 칠하거나, 4위 이상이면 원을 숨기고 숫자만 남긴다.
  // 템플릿은 항상 rank-badge-gold-4(금색) 하나이므로 이 헬퍼를 통해 시각만 덮어쓴다.
  _applyBadgeRankStyle(badgeEl, rank) {
    const inner = badgeEl.firstElementChild;
    if (!inner) return;
    // 깨끗한 상태에서 시작 (재사용/복제 잔존 스타일 방지)
    inner.style.background = '';
    inner.style.borderColor = '';
    inner.style.border = '';
    inner.style.boxShadow = '';

    const baseShadow = '0px 2px 5px rgba(0,0,0,0.3),inset 0px 1px 4px -2px rgba(255,255,255,0.3)';
    if (rank === 1) {
      // 금: 템플릿 기본값. 명시적으로 덮어써서 cssText 잔존을 보장.
      inner.style.background = 'linear-gradient(180deg,#ffd700,#c8960a)';
      inner.style.borderColor = '#ffe680';
      inner.style.boxShadow = `0 2px 0 0 #8a6200,${baseShadow}`;
    } else if (rank === 2) {
      // 은
      inner.style.background = 'linear-gradient(180deg,#c0c0c0,#909090)';
      inner.style.borderColor = '#e0e0e0';
      inner.style.boxShadow = `0 2px 0 0 #606060,${baseShadow}`;
    } else if (rank === 3) {
      // 동
      inner.style.background = 'linear-gradient(180deg,#cd7f32,#9a5200)';
      inner.style.borderColor = '#e8a060';
      inner.style.boxShadow = `0 2px 0 0 #6a3200,${baseShadow}`;
    } else {
      // 4위 이상(또는 100+): 원/테두리/그림자 제거, 숫자만 노출
      inner.style.background = 'transparent';
      inner.style.border = 'none';
      inner.style.boxShadow = 'none';
    }
  }

  _buildRankRow(tmplRow, tmplBadge, tmplCrown, tmplCrownImg, entry, rank, isMe, i) {
    const svc = this._leaderboardService;

    // ── rank-row-3 복제 ──
    const rowEl = tmplRow.cloneNode(true);
    rowEl.removeAttribute('data-stable-id');
    rowEl.style.left = '0px';
    rowEl.style.top  = `${i * ROW_HEIGHT}px`;
    if (isMe) rowEl.dataset.myRank = '1';

    const rowInner = rowEl.firstElementChild;
    if (rowInner && isMe) {
      rowInner.style.background = SceneRenderer.utils.depthGradientCss('#c8860a', 35);
    }

    const nameSpan  = rowEl.querySelector('.text-0');
    const levelSpan = rowEl.querySelector('.text-1');
    if (nameSpan)  nameSpan.textContent  = entry.name;
    if (levelSpan) levelSpan.textContent = String(entry.level);

    const flagImg = rowEl.querySelector('img');
    if (flagImg) {
      const noflag = svc.getNoflag(entry.id);
      const flagPath = entry.country
        ? `assets/ctry/${entry.country.toUpperCase()}.webp`
        : `assets/ctry/${noflag}`;
      flagImg.src = flagPath;
      flagImg.onerror = () => { flagImg.src = `assets/ctry/${noflag}`; };
    }

    // ── rank-badge-gold-4 복제 ──
    const badgeEl = tmplBadge.cloneNode(true);
    badgeEl.removeAttribute('data-stable-id');
    badgeEl.style.left = `${TMPL_X.badge - TMPL_X.row}px`;
    badgeEl.style.top  = `${i * ROW_HEIGHT + (TMPL_Y.badge - TMPL_Y.row)}px`;

    const rankSpan = badgeEl.querySelector('.text-0');
    if (rankSpan) rankSpan.textContent = String(rank);
    this._applyBadgeRankStyle(badgeEl, rank);

    // ── 포인트는 전체 랭커에게 표시, 크라운 이미지는 1~3위만 표시 ──
    let crownEl = null, crownImgEl = null;
    if (tmplCrown) {
      crownEl = tmplCrown.cloneNode(true);
      crownEl.removeAttribute('data-stable-id');
      crownEl.style.left = `${TMPL_X.crown - TMPL_X.row}px`;
      crownEl.style.top  = `${i * ROW_HEIGHT + (TMPL_Y.crown - TMPL_Y.row)}px`;
      const pointSpan = crownEl.querySelector('.text-0');
      if (pointSpan) pointSpan.textContent = String(entry.point ?? 0);
    }
    if (rank <= 3) {
      if (tmplCrownImg) {
        crownImgEl = tmplCrownImg.cloneNode(true);
        crownImgEl.removeAttribute('data-stable-id');
        crownImgEl.style.left = `${TMPL_X.crownImg - TMPL_X.row}px`;
        crownImgEl.style.top  = `${i * ROW_HEIGHT + (TMPL_Y.crownImg - TMPL_Y.row)}px`;
      }
    }

    return { rowEl, badgeEl, crownEl, crownImgEl };
  }

  _grantPopupRewards(rewards) {
    const itemRewards = rewards.filter(r => r.reward_type === 'item' && r.reward_key);
    itemRewards.forEach(reward => this._itemService?.add?.(reward.reward_key, reward.amount ?? 1));
    this._cloudSaveService?.markDirty?.();
    this._refreshBoostBadge();
    this._animatePopupRewardItems(itemRewards);
  }

  _animatePopupRewardItems(itemRewards) {
    const target = this._renderer._navHostRenderer?.getElement('start_gamestg') ?? this._findElement('start_gamestg');
    if (!target) return;

    const targetRect = target.getBoundingClientRect();
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    const items = itemRewards.map((reward, i) => {
      const img = this._createRewardItemImage(reward);
      const offset = (i - (itemRewards.length - 1) / 2) * 18;
      const transform = `translate(${startX + offset}px, ${startY}px) translate(-50%,-50%) scale(1.1)`;
      img.style.transform = transform;
      document.body.appendChild(img);
      return { img, offset };
    });

    setTimeout(() => { void this._sendRewardItemsOverlapped(items, { startX, startY, endX, endY }); }, 1000);
  }

  _createRewardItemImage(reward) {
    const img = document.createElement('img');
    img.src = reward.icon;
    img.alt = '';
    img.style.cssText = [
      'position:fixed', 'width:54px', 'height:54px', 'object-fit:contain',
      'left:0', 'top:0', 'z-index:2400', 'pointer-events:none',
      'opacity:1',
      'filter:drop-shadow(0 8px 12px rgba(0,0,0,.35))',
    ].join(';');
    return img;
  }

  async _sendRewardItemsOverlapped(items, points) {
    await Promise.all(items.map((item, i) => this._animateSingleRewardItem(item, points, i * 220)));
  }

  _animateSingleRewardItem({ img, offset }, { startX, startY, endX, endY }, delayMs = 0) {
    return new Promise(resolve => {
      const from = `translate(${startX + offset}px, ${startY}px) translate(-50%,-50%) scale(1.1)`;
      const to = `translate(${endX}px, ${endY}px) translate(-50%,-50%) scale(1.1)`;
      img.animate([
        { transform: from, opacity: 1 },
        { transform: to, opacity: 1 },
      ], {
        duration: 620,
        delay: delayMs,
        easing: 'cubic-bezier(.2,.75,.25,1)',
        fill: 'forwards',
      }).onfinish = () => {
        img.remove();
        this._soundService?.playItemDrop?.();
        this._playStartStagePulse();
        resolve();
      };
    });
  }

  _playStartStagePulse() {
    const el = this._renderer._navHostRenderer?.getElement('start_gamestg') ?? this._findElement('start_gamestg');
    if (!el) return;
    const effect = SceneRenderer.utils.normalizeCssAnimationEffect({
      cssAnimation: { enabled: true, presetId: 'pulse', duration: 0.8, repeat: 1 },
    });
    SceneRenderer.utils.applyCssAnimationEffect(el, effect);
  }

  async _buildStickyMyRank(panel, tmplRow, tmplBadge, tmplCrown, tmplCrownImg, myRank, myEntry) {
    const svc = this._leaderboardService;
    const isOver100 = !myRank;

    // sticky 행 생성
    const rowEl = tmplRow.cloneNode(true);
    rowEl.removeAttribute('data-stable-id');
    rowEl.style.cssText = [
      'position:absolute',
      `left:${TMPL_X.row}px`,
      'bottom:10px',
      'z-index:11',
    ].join(';');
    rowEl.style.top = '';

    const rowInner = rowEl.firstElementChild;
    if (rowInner) {
      rowInner.style.background = SceneRenderer.utils.depthGradientCss('#c8860a', 35);
    }

    const nameSpan  = rowEl.querySelector('.text-0');
    const levelSpan = rowEl.querySelector('.text-1');
    const myLevel = this._levelManager?.currentIndex ?? 0;
    const [myName, myId] = await Promise.all([svc.getUserName(), svc.getUserId()]);
    if (nameSpan)  nameSpan.textContent  = myEntry?.name  ?? myName;
    if (levelSpan) levelSpan.textContent = myEntry?.level != null ? String(myEntry.level) : String(myLevel);

    const flagImg = rowEl.querySelector('img');
    if (flagImg) {
      const noflag = svc.getNoflag(myId);
      const country = myEntry?.country ?? await this._statsService?.getFlag?.();
      flagImg.src = country
        ? `assets/ctry/${country.toUpperCase()}.webp`
        : `assets/ctry/${noflag}`;
      flagImg.onerror = () => { flagImg.src = `assets/ctry/${noflag}`; };
    }

    // sticky 뱃지 생성
    const badgeEl = tmplBadge.cloneNode(true);
    badgeEl.removeAttribute('data-stable-id');
    badgeEl.style.cssText = [
      'position:absolute',
      `left:${TMPL_X.badge}px`,
      'bottom:21px',    // 10(row bottom) + 58(row h) - 13(badge offset) - 34(badge h)
      'z-index:12',
    ].join(';');
    badgeEl.style.top = '';

    const rankSpan = badgeEl.querySelector('.text-0');
    if (rankSpan) rankSpan.textContent = isOver100 ? '100+' : String(myRank);
    // 100+ 는 4위 이상 취급(원 없이 숫자만)
    this._applyBadgeRankStyle(badgeEl, isOver100 ? 999 : myRank);

    let crownEl = null;
    if (tmplCrown) {
      crownEl = tmplCrown.cloneNode(true);
      crownEl.removeAttribute('data-stable-id');
      crownEl.style.cssText = [
        'position:absolute',
        `left:${TMPL_X.crown}px`,
        'bottom:27px',
        'z-index:12',
      ].join(';');
      crownEl.style.top = '';
      const pointSpan = crownEl.querySelector('.text-0');
      if (pointSpan) pointSpan.textContent = String(myEntry?.point ?? this._levelManager?.getHiddenLeagueState?.()?.point ?? 0);
    }

    let crownImgEl = null;
    if (tmplCrownImg) {
      crownImgEl = tmplCrownImg.cloneNode(true);
      crownImgEl.removeAttribute('data-stable-id');
      crownImgEl.style.cssText = [
        'position:absolute',
        `left:${TMPL_X.crownImg}px`,
        'bottom:29px',
        'z-index:13',
      ].join(';');
      crownImgEl.style.top = '';
    }

    panel.appendChild(rowEl);
    panel.appendChild(badgeEl);
    if (crownEl) panel.appendChild(crownEl);
    if (crownImgEl) panel.appendChild(crownImgEl);
    this._lbStickyEl = { row: rowEl, badge: badgeEl, crown: crownEl, crownImg: crownImgEl };

    // 초기 상태: 100위 밖이면 항상 노출, 아니면 visibility 체크 후 결정
    if (isOver100) {
      rowEl.style.display  = '';
      badgeEl.style.display = '';
      if (crownEl) crownEl.style.display = '';
      if (crownImgEl) crownImgEl.style.display = '';
    } else {
      rowEl.style.display  = 'none';
      badgeEl.style.display = 'none';
      if (crownEl) crownEl.style.display = 'none';
      if (crownImgEl) crownImgEl.style.display = 'none';
    }
  }

  _checkMyRankVisibility(scrollEl) {
    if (!this._myRankRowEl || !this._lbStickyEl) return;
    const myRow = this._myRankRowEl;
    const myTop = parseInt(myRow.style.top, 10);
    const scrollTop    = scrollEl.scrollTop;
    const visibleBottom = scrollTop + scrollEl.clientHeight;
    const isVisible = myTop >= scrollTop && (myTop + 58) <= visibleBottom;
    const show = !isVisible;
    this._lbStickyEl.row.style.display   = show ? '' : 'none';
    this._lbStickyEl.badge.style.display  = show ? '' : 'none';
    if (this._lbStickyEl.crown) this._lbStickyEl.crown.style.display = show ? '' : 'none';
    if (this._lbStickyEl.crownImg) this._lbStickyEl.crownImg.style.display = show ? '' : 'none';
  }

  // 마지막 갱신 시각이 lastUpdatedMs면 stale 라벨 표시, null이면 제거
  _renderStaleLabel(lastUpdatedMs) {
    this._lbStaleEl?.remove();
    this._lbStaleEl = null;
    if (!lastUpdatedMs) return;
    if (this._renderer._activeTab !== 't4') return;
    const panel = this._renderer._navHostRenderer?._el;
    if (!panel) return;

    const minutes = Math.max(1, Math.floor((Date.now() - lastUpdatedMs) / 60_000));
    const text = minutes < 60
      ? `마지막 갱신 ${minutes}분 전 (오프라인)`
      : minutes < 1440
        ? `마지막 갱신 ${Math.floor(minutes / 60)}시간 전 (오프라인)`
        : `마지막 갱신 ${Math.floor(minutes / 1440)}일 전 (오프라인)`;

    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      `left:${TMPL_X.row}px`,
      'bottom:78px',          // sticky 행(58) + bottom(10) + 간격(10)
      'width:320px',
      'height:22px',
      'line-height:22px',
      'text-align:center',
      'font-size:11px',
      'color:#fff',
      'background:rgba(0,0,0,0.55)',
      'border-radius:11px',
      'z-index:11',
      'pointer-events:none',
    ].join(';');
    el.textContent = text;
    panel.appendChild(el);
    this._lbStaleEl = el;
  }

  // 서버 응답은 성공했지만 아직 데이터 없음
  _renderEmptyLeaderboard() {
    this._lbScrollEl?.remove();
    this._lbStickyEl?.row?.remove();
    this._lbStickyEl?.badge?.remove();
    this._lbStickyEl?.crown?.remove();
    this._lbStickyEl?.crownImg?.remove();
    this._lbStaleEl?.remove();
    this._lbOfflineEl?.remove();
    this._lbScrollEl = null;
    this._lbStickyEl = null;
    this._lbStaleEl = null;
    this._lbOfflineEl = null;
    this._myRankRowEl = null;

    if (this._renderer._activeTab !== 't4') return;
    const panel = this._renderer._navHostRenderer?._el;
    if (!panel) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:absolute',
      `left:${TMPL_X.row}px`,
      `top:${TMPL_Y.row + 120}px`,
      'width:320px',
      'text-align:center',
      'color:#fff',
      'z-index:10',
    ].join(';');

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;line-height:1.6;opacity:0.9;';
    msg.innerHTML = '아직 리더보드 데이터가 없습니다.<br>게임을 완료하면 순위가 등록됩니다.';

    wrap.appendChild(msg);
    panel.appendChild(wrap);
    this._lbOfflineEl = wrap;
  }

  // 캐시도 없고 오프라인일 때: 안내 + 재시도 버튼
  _renderOfflineEmpty(reason) {
    this._lbScrollEl?.remove();
    this._lbStickyEl?.row?.remove();
    this._lbStickyEl?.badge?.remove();
    this._lbStickyEl?.crown?.remove();
    this._lbStickyEl?.crownImg?.remove();
    this._lbStaleEl?.remove();
    this._lbOfflineEl?.remove();
    this._lbScrollEl = null;
    this._lbStickyEl = null;
    this._lbStaleEl = null;
    this._lbOfflineEl = null;
    this._myRankRowEl = null;

    if (this._renderer._activeTab !== 't4') return;
    const panel = this._renderer._navHostRenderer?._el;
    if (!panel) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:absolute',
      `left:${TMPL_X.row}px`,
      `top:${TMPL_Y.row + 120}px`,
      'width:320px',
      'text-align:center',
      'color:#fff',
      'z-index:10',
    ].join(';');

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;line-height:1.6;margin-bottom:18px;opacity:0.9;';
    msg.innerHTML = `네트워크 연결을 확인해주세요.<br>리더보드는 인터넷 연결 시 표시됩니다.<br><span style="font-size:11px;opacity:0.6">[${reason ?? '?'}]</span>`;

    const btn = document.createElement('button');
    btn.textContent = '다시 시도';
    btn.style.cssText = [
      'padding:10px 28px',
      'font-size:13px',
      'color:#fff',
      'background:#c8860a',
      'border:none',
      'border-radius:8px',
      'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', () => this._refreshLeaderboard());

    wrap.appendChild(msg);
    wrap.appendChild(btn);
    panel.appendChild(wrap);
    this._lbOfflineEl = wrap;
  }

  // ── Scale ─────────────────────────────────────────────────────────────────

  _updateScale() {
    const stage = this._renderer._el;
    if (!stage) return;
    const c = this._renderer._contract;
    applyScale(stage, null, c?.canvas?.width || 390, c?.viewport?.height || c?.canvas?.height || 844, true);
  }
}
