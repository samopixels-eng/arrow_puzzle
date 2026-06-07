const STORAGE_PREFIX  = 'dotlink_';
const STORAGE_KEY     = 'muted';
const BGM_MUTED_KEY   = 'bgm_muted';
const SFX_MUTED_KEY   = 'sfx_muted';
const HAPTIC_KEY      = 'haptic';
const BGM_SRC         = 'assets/sounds/The_Sorting_Room_optimized.mp3';
const HIDDEN_BGM_SRC  = 'assets/sounds/hiden_bgm.mp3';
const UI_OPEN_SRC     = 'assets/sounds/ui_open.mp3';
const UI_CLOSE_SRC    = 'assets/sounds/ui_close.mp3';
const COIN_FALLING_SRC = 'assets/sounds/coin_falling.mp3';
const ICE_BREAK_SRC    = 'assets/sounds/ice_break.mp3';
const ITEM_DROP_SRC    = 'assets/sounds/item_drop.wav';

// 전역 클릭 위임 셀렉터
// - button / .action-button 등 : CSS :active 눌림효과 요소
// - [data-nav-tab]            : SceneRenderer 네비게이션 탭 (default btn + layer trigger 모두)
// - [data-sound]              : pressEnabled 없는 event-only 요소에 명시적으로 부여
const UI_STATIC_SEL = 'button, .action-button, .clear-next-btn, [data-nav-tab], [data-sound]';
const UI_CLOSE_SEL  = '[data-sound="close"], .close-btn, [data-stable-id*="close"]';

export class SoundService {
  constructor({ storagePrefix = STORAGE_PREFIX } = {}) {
    this._storagePrefix = storagePrefix;
    this.ctx = null;
    this.muted = false;
    this._initialized = false;
    this._bgm = null;
    this._bgmSrc = BGM_SRC;
    this._bgmReady = false;
    this._bgmMuted = false;
    this._sfxMuted = false;
    this._hapticEnabled = true;
    this._uiOpen = new Audio(UI_OPEN_SRC);
    this._uiOpen.volume = 0.7;
    this._uiClose = new Audio(UI_CLOSE_SRC);
    this._uiClose.volume = 0.7;
    this._coinFalling = new Audio(COIN_FALLING_SRC);
    this._coinFalling.volume = 0.85;
    this._iceBreak = new Audio(ICE_BREAK_SRC);
    this._iceBreak.volume = 0.9;
    this._itemDrop = new Audio(ITEM_DROP_SRC);
    this._itemDrop.volume = 0.85;
    this._loadStates();
    this._bgm = this._createBgmAudio(this._bgmSrc);
  }

  // ── 전역 UI 사운드 위임 초기화 ────────────────────────────────────────────
  // main.js의 App.init()에서 1회 호출. 이후 모든 버튼 클릭에 자동 적용됨.

  initGlobalUI() {
    document.addEventListener('click', (e) => {
      // 1) 정적 셀렉터 (CSS 버튼, 네비 탭, 명시적 data-sound)
      if (e.target.closest(UI_STATIC_SEL)) {
        e.target.closest(UI_CLOSE_SEL) ? this.playUIClose() : this.playUIOpen();
        return;
      }
      // 2) SceneRenderer pressEnabled: inner div에 cursor:pointer 인라인 스타일이 부여됨.
      //    클릭 이벤트 경로를 걸어올라가며 감지.
      let el = e.target;
      while (el && el !== document.body) {
        if (el.style?.cursor === 'pointer') {
          el.closest(UI_CLOSE_SEL) ? this.playUIClose() : this.playUIOpen();
          return;
        }
        el = el.parentElement;
      }
    });
  }

  // ── BGM ──────────────────────────────────────────────────────────────────

  _createBgmAudio(src) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.7;
    return audio;
  }

  _loadStates() {
    try {
      this.muted = localStorage.getItem(this._storageKey(STORAGE_KEY)) === '1';
      const bgmVal = localStorage.getItem(this._storageKey(BGM_MUTED_KEY));
      this._bgmMuted = bgmVal !== null ? bgmVal === '1' : this.muted;
      const sfxVal = localStorage.getItem(this._storageKey(SFX_MUTED_KEY));
      this._sfxMuted = sfxVal !== null ? sfxVal === '1' : this.muted;
      const hapticVal = localStorage.getItem(this._storageKey(HAPTIC_KEY));
      this._hapticEnabled = hapticVal !== null ? hapticVal === '1' : true;
    } catch {}
  }

  _save(key, value) {
    try { localStorage.setItem(this._storageKey(key), value ? '1' : '0'); } catch {}
  }

  _storageKey(key) {
    return `${this._storagePrefix}${key}`;
  }

  _init() {
    if (this._initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initialized = true;
    } catch {}
  }

  // ── BGM ──────────────────────────────────────────────────────────────────

  startBgm() {
    if (this._bgmReady || this._bgmMuted) return;
    this._bgm?.play().then(() => {
      this._bgmReady = true;
    }).catch(() => {});
  }

  toggleBgm() {
    return this.setBgmEnabled(this._bgmMuted); // muted → enable, enabled → mute
  }

  setBgmEnabled(enabled) {
    this._bgmMuted = !enabled;
    this._save(BGM_MUTED_KEY, this._bgmMuted);
    if (this._bgm) {
      if (this._bgmMuted) {
        this._bgm.pause();
      } else {
        this._bgm.play().then(() => { this._bgmReady = true; }).catch(() => {});
      }
    }
    return this._bgmMuted;
  }

  isBgmMuted() { return this._bgmMuted; }

  pauseBgm() {
    if (this._bgm && this._bgmReady) this._bgm.pause();
  }

  resumeBgm() {
    if (this._bgm && this._bgmReady && !this._bgmMuted) {
      this._bgm.play().catch(() => {});
    }
  }

  setHiddenLeagueBgm(enabled) {
    const nextSrc = enabled ? HIDDEN_BGM_SRC : BGM_SRC;
    if (this._bgmSrc === nextSrc) return;

    const wasPlaying = this._bgm && !this._bgm.paused;
    const currentTime = this._bgm?.currentTime ?? 0;
    this._bgm?.pause();

    this._bgmSrc = nextSrc;
    this._bgm = this._createBgmAudio(nextSrc);
    this._bgmReady = false;

    try {
      if (enabled) this._bgm.currentTime = 0;
      else if (Number.isFinite(currentTime)) this._bgm.currentTime = currentTime;
    } catch {}

    if (wasPlaying && !this._bgmMuted) {
      this._bgm.play().then(() => { this._bgmReady = true; }).catch(() => {});
    }
  }

  // ── SFX ──────────────────────────────────────────────────────────────────

  toggleSfx() {
    return this.setSfxEnabled(this._sfxMuted); // muted → enable, enabled → mute
  }

  setSfxEnabled(enabled) {
    this._sfxMuted = !enabled;
    this._save(SFX_MUTED_KEY, this._sfxMuted);
    return this._sfxMuted;
  }

  isSfxMuted() { return this._sfxMuted; }

  playUIOpen() {
    if (this._sfxMuted) return;
    this._uiOpen.currentTime = 0;
    this._uiOpen.play().catch(() => {});
  }

  playUIClose() {
    if (this._sfxMuted) return;
    this._uiClose.currentTime = 0;
    this._uiClose.play().catch(() => {});
  }

  playCoinFalling() {
    if (this._sfxMuted) return;
    this._coinFalling.currentTime = 0;
    this._coinFalling.play().catch(() => {});
  }

  playIceBreak() {
    if (this._sfxMuted) return;
    this._iceBreak.currentTime = 0;
    this._iceBreak.play().catch(() => {});
  }

  playItemDrop() {
    if (this._sfxMuted) return;
    this._itemDrop.currentTime = 0;
    this._itemDrop.play().catch(() => {});
  }

  // ── Haptic ────────────────────────────────────────────────────────────────

  toggleHaptic() {
    this._hapticEnabled = !this._hapticEnabled;
    this._save(HAPTIC_KEY, this._hapticEnabled);
    return this._hapticEnabled;
  }

  isHapticEnabled() { return this._hapticEnabled; }

  // ── 레거시 통합 Mute (하위 호환) ───────────────────────────────────────────

  toggleMute() {
    this.muted = !this.muted;
    this._save(STORAGE_KEY, this.muted);
    if (this._bgm) {
      if (this.muted) { this._bgm.pause(); }
      else { this._bgm.play().then(() => { this._bgmReady = true; }).catch(() => {}); }
    }
    return this.muted;
  }

  isMuted() { return this.muted; }

  // ── Web Audio 합성음 ──────────────────────────────────────────────────────

  _playTone(freq, duration, type = 'sine', volume = 0.3) {
    if (this._sfxMuted) return;
    this._init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + duration);
    } catch {}
  }

  playSegment() { this._playTone(600, 0.05, 'square', 0.1); }

  playConnect() {
    this._playTone(880, 0.15, 'sine', 0.25);
    setTimeout(() => this._playTone(1100, 0.15, 'sine', 0.2), 80);
  }

  playClear() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      setTimeout(() => this._playTone(freq, 0.3, 'sine', 0.25), i * 100);
    });
  }

  playError() { this._playTone(200, 0.15, 'sawtooth', 0.15); }
}
