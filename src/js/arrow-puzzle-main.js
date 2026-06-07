import { SplashScreen } from "./screens/splash-screen.js";
import { LogoScreen } from "./screens/logo-screen.js";
import { ClearScreen } from "./screens/clear-screen.js";
import { LobbyScreen } from "./screens/lobby-screen.js";
import { createOutgameRuntime } from "./outgame/create-outgame-runtime.js";
import { createArrowPuzzleGameAdapter } from "./outgame/arrow-puzzle-game-adapter.js";
import { ARROW_PUZZLE_GAME_CONFIG } from "./outgame/arrow-puzzle-game-config.js";
import { ArrowPuzzleLevelManager } from "./arrow-puzzle-level-manager.js";
import { showToast } from "./utils/toast.js";
import { getNativePlugin } from "./utils/capacitor-plugins.js";

const DEV_MODE = !window.Capacitor?.isNativePlatform();

class App {
  constructor() {
    this.container = document.getElementById("app");
    const gameAdapter = createArrowPuzzleGameAdapter(ARROW_PUZZLE_GAME_CONFIG);
    const levelManager = new ArrowPuzzleLevelManager({
      storagePrefix: ARROW_PUZZLE_GAME_CONFIG.storagePrefix,
    });

    Object.assign(this, createOutgameRuntime({
      config: ARROW_PUZZLE_GAME_CONFIG,
      gameAdapter,
      levelManager,
    }));

    this.gameScreen = null;
    this.clearScreen = null;
    this.currentScreen = null;

    this._lobby = new LobbyScreen(this.container, {
      onStartGame: opts => this.startGame(opts),
      onRestartApp: () => this.restart(),
      soundService: this.soundService,
      coinService: this.coinService,
      levelManager: this.levelManager,
      heartService: this.heartService,
      adService: this.adService,
      itemService: this.itemService,
      leaderboardService: this.leaderboardService,
      authService: this.authService,
      cloudSaveService: this.cloudSaveService,
      statsService: this.statsService,
      purchaseService: this.purchaseService,
    });

    this._handleVisibilityChange = () => this._onVisibilityChange();
    this._handlePageHide = () => this.cloudSaveService.uploadNow();
    this._handleOnline = () => this.cloudSaveService.syncIfNeeded();
  }

  _createStartupRunner(tasks) {
    let started = false;
    const states = tasks.map(task => ({ run: task.run, promise: null }));

    const start = () => {
      if (started) return;
      started = true;

      let chain = Promise.resolve();
      for (const state of states) {
        state.promise = chain.then(() => state.run());
        state.promise.catch(() => {});
        chain = state.promise;
      }
    };

    return {
      start,
      getTasks: () => states.map(state => ({
        run: () => {
          start();
          return state.promise;
        },
      })),
    };
  }

  async init() {
    try {
      await getNativePlugin("StatusBar")?.hide?.();
    } catch {}

    document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    document.addEventListener("visibilitychange", this._handleVisibilityChange);
    window.removeEventListener("pagehide", this._handlePageHide);
    window.addEventListener("pagehide", this._handlePageHide);
    window.removeEventListener("online", this._handleOnline);
    window.addEventListener("online", this._handleOnline);

    this.soundService.initGlobalUI();

    const startup = this._createStartupRunner([
      { run: () => this.levelManager.loadLevels() },
      { run: () => this.authService.initIdentity() },
      { run: () => this.purchaseService.init() },
      { run: () => this.cloudSaveService.syncOnStartup() },
      { run: () => this._lobby.load() },
      { run: () => this.leaderboardService.getLeaderboard() },
    ]);

    const logo = new LogoScreen(this.container);
    const splash = new SplashScreen(this.container);
    await Promise.all([logo.load(), splash.load()]);
    startup.start();
    await logo.show();
    logo.hide();

    await splash.show(startup.getTasks(), {
      onTouchToStart: () => this.soundService.startBgm(),
    });
    splash.hide();

    if (this.levelManager.getTotalLevels() === 0) {
      this.container.innerHTML = `
        <div style="color:#fff;text-align:center;padding:40px;font-family:sans-serif">
          <h2>No Levels Found</h2>
          <p>Load Arrow Puzzle levels before starting the outgame shell.</p>
        </div>
      `;
      return;
    }

    if (await this.statsService.resolveInterruptedAttempt()) {
      this.cloudSaveService.markDirty();
    }
    this.showLobby();
    this.cloudSaveService.watchLocalChanges();
  }

  async restart() {
    this._clearScreens();
    const splash = new SplashScreen(this.container);
    await splash.load();
    await splash.show([
      { run: () => this.levelManager.loadLevels() },
      { run: () => this.authService.initIdentity() },
      { run: () => this.purchaseService.init() },
      { run: () => this.cloudSaveService.syncOnStartup() },
      { run: () => this.leaderboardService.getLeaderboard() },
    ], {
      onTouchToStart: () => this.soundService.startBgm(),
    });
    splash.hide();
    if (await this.statsService.resolveInterruptedAttempt()) {
      this.cloudSaveService.markDirty();
    }
    this.showLobby();
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this.soundService.pauseBgm();
      this.cloudSaveService.uploadNow();
    } else {
      this.soundService.resumeBgm();
      this.cloudSaveService.syncIfNeeded();
    }
  }

  showLobby() {
    this._clearScreens();
    this._lobby.show();
    this.currentScreen = "lobby";
  }

  async startGame({ boostTime30 = false } = {}) {
    if (!this.heartService.canPlay()) {
      this._showNoHeartToast();
      return;
    }
    this.heartService.consume();

    this._clearScreens();
    const level = this.levelManager.getCurrentLevel();
    if (!level) {
      this.showLobby();
      return;
    }

    const attemptStageKey = this.levelManager.getAttemptStageKey();
    await this.statsService.beginStageAttempt(attemptStageKey);

    this.gameScreen = this.gameAdapter.createGameScreen(this.container, {
      onClear: stats => this.showClear(stats),
      onLeave: () => this._handleStageDefeat(),
      devMode: DEV_MODE,
      totalLevels: this.levelManager.getOpenLevelCount(),
      onDevNav: delta => this._devNavLevel(delta),
      onDevJump: index => this._devJumpLevel(index),
    });

    await this.gameAdapter.showGameScreen(this.gameScreen, {
      level,
      stageLabel: this.levelManager.getCurrentStageLabel(),
      services: {
        soundService: this.soundService,
        adService: this.adService,
        coinService: this.coinService,
        itemService: this.itemService,
      },
      options: {
        boostTime30,
        purchaseService: this.purchaseService,
        authService: this.authService,
        levelDisplayLabel: this.gameAdapter.getLevelDisplayLabel(this.levelManager),
      },
    });
    this.currentScreen = "game";
  }

  async showClear() {
    this.heartService.restore();
    const attemptStageKey = this.levelManager.getAttemptStageKey();
    await this.statsService.completeStageAttempt(attemptStageKey);
    this.cloudSaveService.markDirty();

    this.clearScreen = new ClearScreen(this.container, {
      onNextLevel: () => {
        const clearedStage = this.levelManager.getCurrentLevelNumber();
        this.levelManager.advanceLevel();
        this.cloudSaveService.markDirty();
        if (this.gameAdapter.shouldReturnToLobbyAfterClear({ clearedStage })) {
          this._clearScreens();
          this.showLobby();
        } else {
          this._clearScreens();
          this.startGame();
        }
      },
      onWatchAd: () => this.adService.showRewardedAd("coins"),
      onForcedInterstitial: () => this.adService.showInterstitialAd(),
      onShowBanner: () => this.adService.showBannerAd(),
      onHideBanner: () => this.adService.hideBannerAd(),
      hasNoAds: async () => {
        const ent = await this.authService?.getPreference?.("entitlements");
        return !!ent?.no_ads;
      },
      getCurrentLevel: () => this.levelManager.getCurrentLevelNumber(),
    }, this.coinService, this.soundService);
    this.clearScreen.show();
    this.currentScreen = "clear";
  }

  _showNoHeartToast() {
    showToast("하트가 부족합니다. 잠시 후 다시 시도하세요.");
  }

  async _handleStageDefeat() {
    await this.statsService.abandonStageAttempt(this.levelManager.getAttemptStageKey());
    this.cloudSaveService.markDirty();
    this.showLobby();
  }

  _devNavLevel(delta) {
    const total = this.levelManager.getOpenLevelCount();
    const next = Math.max(0, Math.min(total - 1, this.levelManager.currentIndex + delta));
    this.levelManager.setProgressIndex(next);
    this._clearScreens();
    this.startGame();
  }

  _devJumpLevel(index) {
    const total = this.levelManager.getOpenLevelCount();
    const clamped = Math.max(0, Math.min(total - 1, index - 1));
    this.levelManager.setProgressIndex(clamped);
    this._clearScreens();
    this.startGame();
  }

  _clearScreens() {
    this._lobby.hide();
    if (this.gameScreen) {
      this.gameScreen.hide();
      this.gameScreen = null;
    }
    if (this.clearScreen) {
      this.clearScreen.hide();
      this.clearScreen = null;
    }
  }
}

function boot() {
  document.body.dataset.arrowOutgameBoot = "started";
  const app = new App();
  window.__arrowOutgameAppLoaded = true;
  app.init().then(() => {
    document.body.dataset.arrowOutgameBoot = "ready";
  }).catch(error => {
    document.body.dataset.arrowOutgameBoot = "error";
    console.error("[ARROW_PUZZLE_OUTGAME] init failed", error);
    const container = document.getElementById("app");
    if (container) {
      container.innerHTML = `
        <div style="color:#fff;background:#111827;min-height:100vh;padding:24px;font-family:sans-serif">
          <h2>Outgame init failed</h2>
          <pre style="white-space:pre-wrap">${String(error?.message || error)}</pre>
        </div>
      `;
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
