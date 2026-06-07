const DEFAULT_STORAGE_PREFIX = "arrow_puzzle_";
const PROGRESS_KEY = "current_level";

export class ArrowPuzzleLevelManager {
  constructor({
    levels = null,
    storagePrefix = DEFAULT_STORAGE_PREFIX,
  } = {}) {
    this.levels = Array.isArray(levels) ? levels : [];
    this.currentIndex = 0;
    this._storagePrefix = storagePrefix;
    this._listeners = [];
  }

  async loadLevels() {
    if (!this.levels.length && Array.isArray(window.ARROW_PUZZLE_LEVELS)) {
      this.levels = window.ARROW_PUZZLE_LEVELS;
    }
    this.levels = this.levels.map((level, index) => this._normalizeLevel(level, index));
    this.currentIndex = this._loadProgress();
  }

  getCurrentLevel() {
    if (this.levels.length === 0) return null;
    const index = Math.max(0, Math.min(this.levels.length - 1, this.currentIndex));
    return this._withOutgameIndex(this.levels[index], index);
  }

  getCurrentLevelNumber() {
    return this.currentIndex + 1;
  }

  getClearedLevelNumber() {
    return this.currentIndex;
  }

  getCurrentStageLabel() {
    return String(this.getCurrentLevelNumber());
  }

  getTotalLevels() {
    return this.levels.length;
  }

  getOpenLevelCount() {
    return this.levels.length;
  }

  getMaxReleasedStageNumber() {
    return this.getOpenLevelCount();
  }

  getAttemptStageKey() {
    return `normal:${this.currentIndex}`;
  }

  advanceLevel() {
    this.setProgressIndex(Math.min(this.currentIndex + 1, this.levels.length));
  }

  setProgressIndex(index) {
    const max = Math.max(0, this.levels.length);
    const next = Number.isFinite(index) ? Math.trunc(index) : 0;
    this.currentIndex = Math.max(0, Math.min(max, next));
    this._saveProgress();
    this._notify();
  }

  resetProgress() {
    this.setProgressIndex(0);
  }

  hasMoreLevels() {
    return this.currentIndex < this.getOpenLevelCount();
  }

  isHiddenLeague() {
    return false;
  }

  getHiddenLeagueStageNumber() {
    return 1;
  }

  getHiddenLeagueSeasonId() {
    return null;
  }

  getHiddenLeagueState() {
    return null;
  }

  setHiddenLeagueState() {}

  addHiddenLeaguePoint() {}

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(listener => listener !== fn);
    };
  }

  _withOutgameIndex(level, index) {
    if (!level || typeof level !== "object") return level;
    return {
      ...level,
      __outgameIndex: index,
    };
  }

  _normalizeLevel(level, index) {
    if (!level || typeof level !== "object") return level;
    const levelNumber = Number.isFinite(level.level) ? level.level : (level.id ?? index + 1);
    const cols = level.cols ?? level.pointColumns ?? level.columns ?? 0;
    const rows = level.rows ?? level.pointRows ?? 0;
    const grade = level.difficulty?.grade ?? this._estimateDifficultyGrade(level, cols, rows);

    return {
      ...level,
      level: levelNumber,
      cols,
      rows,
      difficulty: {
        ...level.difficulty,
        grade,
      },
    };
  }

  _estimateDifficultyGrade(level, cols, rows) {
    const size = Math.max(cols, rows);
    const arrowCount = Array.isArray(level?.arrows) ? level.arrows.length : 0;

    if (size <= 5) return "Easy";
    if (size <= 6 && arrowCount <= 5) return "Normal";
    if (size <= 7) return "Hard";
    if (size <= 8) return "Expert";
    return "Master";
  }

  _loadProgress() {
    try {
      const saved = localStorage.getItem(this._storageKey(PROGRESS_KEY));
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  _saveProgress() {
    try {
      localStorage.setItem(this._storageKey(PROGRESS_KEY), String(this.currentIndex));
    } catch {}
  }

  _storageKey(key) {
    return `${this._storagePrefix}${key}`;
  }

  _notify() {
    this._listeners.forEach(fn => fn(this.currentIndex));
  }
}

if (typeof window !== "undefined") {
  window.ArrowPuzzleLevelManager = ArrowPuzzleLevelManager;
}
