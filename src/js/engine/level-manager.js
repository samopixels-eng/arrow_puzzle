import { ContentReleaseService } from '../services/content-release-service.js';

const STORAGE_PREFIX = 'dotlink_';
const STORAGE_KEY = 'current_level';
const HIDDEN_STATE_KEY = 'hidden_league_state';
const HIDDEN_POOL_SIZE = 1000;

export class LevelManager {
  constructor(releaseService = new ContentReleaseService(), { storagePrefix = STORAGE_PREFIX } = {}) {
    this.levels = [];
    this.currentIndex = 0;
    this.hiddenState = { season: '', progress: 0, point: 0 };
    this._releaseService = releaseService;
    this._storagePrefix = storagePrefix;
    this._listeners = [];
  }

  async loadLevels() {
    try {
      const response = await fetch('./js/data/levels.json');
      const data = await response.json();
      this.levels = data.levels || [];
    } catch (e) {
      console.error('Failed to load levels:', e);
      this.levels = [];
    }
    this.currentIndex = this._loadProgress();
    this.hiddenState = this._loadHiddenState();
    this._ensureHiddenSeason();
  }

  getCurrentLevel() {
    if (this.levels.length === 0) return null;
    if (this.isHiddenLeague()) return this.getHiddenLeagueLevel();

    const openCount = this.getOpenLevelCount();
    if (openCount <= 0 || this.currentIndex >= openCount) return null;
    return this.levels[this.currentIndex] ?? null;
  }

  getCurrentLevelNumber() {
    return this.currentIndex + 1;
  }

  // 사용자의 레벨(클리어한 정규 스테이지 번호). 일반적으로 도전 스테이지(level_display) - 1.
  // 올클리어 후 히든리그 진입 시에는 max(openCount) 와 동일하게 유지된다.
  // 리더보드의 ranker.level(= current_level_index) 과 일치해야 함.
  getClearedLevelNumber() {
    const openCount = this.getOpenLevelCount();
    if (this.isHiddenLeague()) {
      return openCount;
    }
    if (this.currentIndex >= openCount && openCount > 0) {
      return openCount;
    }
    return this.currentIndex;
  }

  getCurrentStageLabel() {
    return this.isHiddenLeague() ? String(this.getHiddenLeagueStageNumber()) : String(this.getCurrentLevelNumber());
  }

  getTotalLevels() {
    return this.levels.length;
  }

  getOpenLevelCount() {
    return this._releaseService.getOpenLevelCount(this.levels.length);
  }

  getMaxReleasedStageNumber() {
    const openCount = this.getOpenLevelCount();
    return this.levels[Math.max(0, openCount - 1)]?.level ?? openCount;
  }

  getHiddenLeagueSeasonId() {
    return this._releaseService.getSeasonId(this.getOpenLevelCount());
  }

  isHiddenLeague() {
    const openCount = this.getOpenLevelCount();
    return openCount > 0 && this.currentIndex >= openCount;
  }

  getHiddenLeagueLevel() {
    const order = this.getHiddenLeagueOrder();
    if (order.length === 0) return null;
    this._ensureHiddenSeason();
    const idx = order[this.hiddenState.progress % order.length];
    return this.levels[idx] ?? null;
  }

  getHiddenLeagueStageNumber() {
    this._ensureHiddenSeason();
    return (this.hiddenState.progress ?? 0) + 1;
  }

  getHiddenLeagueOrder() {
    const openCount = this.getOpenLevelCount();
    const start = Math.max(0, openCount - HIDDEN_POOL_SIZE);
    const order = [];
    for (let i = start; i < openCount; i++) {
      const grade = String(this.levels[i]?.difficulty?.grade ?? '').toLowerCase();
      if (grade === 'easy') continue;
      order.push(i);
    }
    return this._shuffleDeterministic(order, this.getHiddenLeagueSeasonId());
  }

  getAttemptStageKey() {
    if (this.isHiddenLeague()) {
      this._ensureHiddenSeason();
      return `hidden:${this.hiddenState.season}:${this.hiddenState.progress}`;
    }
    return `normal:${this.currentIndex}`;
  }

  advanceLevel() {
    if (this.isHiddenLeague()) {
      this._ensureHiddenSeason();
      this.hiddenState.progress++;
      this._saveHiddenState();
    } else {
      this.currentIndex++;
      this._saveProgress();
    }
    this._notify();
  }

  addHiddenLeaguePoint(amount) {
    this._ensureHiddenSeason();
    this.hiddenState.point = Math.max(0, (this.hiddenState.point ?? 0) + amount);
    this._saveHiddenState();
    this._saveProgress();
    this._notify();
  }

  getHiddenLeagueState() {
    this._ensureHiddenSeason();
    return { ...this.hiddenState };
  }

  setHiddenLeagueState(state) {
    if (!state || typeof state !== 'object') return;
    this.hiddenState = {
      season: typeof state.season === 'string' ? state.season : '',
      progress: Number.isFinite(state.progress) ? Math.max(0, Math.trunc(state.progress)) : 0,
      point: Number.isFinite(state.point) ? Math.max(0, Math.trunc(state.point)) : 0,
    };
    this._ensureHiddenSeason();
    this._saveHiddenState();
    this._notify();
  }

  setProgressIndex(index) {
    const max = Math.max(0, this.levels.length);
    const next = Number.isFinite(index) ? Math.trunc(index) : 0;
    this.currentIndex = Math.max(0, Math.min(max, next));
    this._saveProgress();
    this._notify();
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  hasMoreLevels() {
    return this.currentIndex < this.getOpenLevelCount();
  }

  _loadProgress() {
    try {
      const saved = localStorage.getItem(this._storageKey(STORAGE_KEY));
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  }

  _saveProgress() {
    try {
      localStorage.setItem(this._storageKey(STORAGE_KEY), this.currentIndex.toString());
    } catch {}
  }

  resetProgress() {
    this.currentIndex = 0;
    this._saveProgress();
    this._notify();
  }

  _loadHiddenState() {
    try {
      const saved = localStorage.getItem(this._storageKey(HIDDEN_STATE_KEY));
      if (!saved) return { season: '', progress: 0, point: 0 };
      const state = JSON.parse(saved);
      return {
        season: typeof state.season === 'string' ? state.season : '',
        progress: Number.isFinite(state.progress) ? Math.max(0, Math.trunc(state.progress)) : 0,
        point: Number.isFinite(state.point) ? Math.max(0, Math.trunc(state.point)) : 0,
      };
    } catch {
      return { season: '', progress: 0, point: 0 };
    }
  }

  _saveHiddenState() {
    try {
      localStorage.setItem(this._storageKey(HIDDEN_STATE_KEY), JSON.stringify(this.hiddenState));
    } catch {}
  }

  _storageKey(key) {
    return `${this._storagePrefix}${key}`;
  }

  _ensureHiddenSeason() {
    const season = this.getHiddenLeagueSeasonId();
    if (this.hiddenState?.season === season) return;
    this.hiddenState = { season, progress: 0, point: 0 };
    this._saveHiddenState();
  }

  _shuffleDeterministic(values, seedText) {
    const arr = [...values];
    let seed = this._hashSeed(seedText);
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  _hashSeed(text) {
    let hash = 2166136261;
    for (const ch of String(text || '')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _notify() {
    this._listeners.forEach(fn => fn(this.currentIndex));
  }
}
