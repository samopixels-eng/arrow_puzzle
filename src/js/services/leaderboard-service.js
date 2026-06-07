import { AuthService } from './auth-service.js';
import { StorageService } from './storage-service.js';

const CACHE_TTL = 10 * 60 * 1000;
const CACHE_KEY = 'leaderboard_cache_top100_min10';
const CACHE_TIME_KEY = 'leaderboard_cache_time';
const CACHE_SEASON_KEY = 'leaderboard_cache_season';

export class LeaderboardService {
  constructor(supabaseUrl, supabaseAnon, authService, { levelManager, storage } = {}) {
    this._url = (supabaseUrl || '').replace(/\/$/, '');
    this._anon = supabaseAnon || '';
    this._auth = authService ?? new AuthService();
    this._levelManager = levelManager ?? null;
    this._storage = storage ?? new StorageService();
    this._cache = null;
    this._cacheTime = 0;
    this._cacheSeason = null;

    const saved = this._storage.get(CACHE_KEY);
    const savedTime = this._storage.get(CACHE_TIME_KEY);
    const savedSeason = this._storage.get(CACHE_SEASON_KEY);
    if (Array.isArray(saved) && saved.length > 0 && typeof savedTime === 'number') {
      this._cache = saved;
      this._cacheTime = savedTime;
      this._cacheSeason = savedSeason ?? null;
    }
  }

  get _ready() {
    return !!(this._url && this._anon);
  }

  get _edgeUrl() {
    return `${this._url}/functions/v1/leaderboard`;
  }

  async getUserId() {
    return (await this._auth.getPreference?.('server_user_id')) || this._auth.getUserId();
  }

  async getUserName() {
    return this._auth.getUserName();
  }

  detectCountry() {
    try {
      const lang = navigator.language || '';
      const parts = lang.split('-');
      if (parts.length >= 2) {
        const code = parts[parts.length - 1].toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) return code;
      }
    } catch {}
    return null;
  }

  getNoflag(userId) {
    const sum = [...(userId || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
    return `noflag${(sum % 4) + 1}.webp`;
  }

  async fetchTop100() {
    if (!this._ready) return { ok: false, reason: 'not_ready' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, reason: 'offline' };
    }

    try {
      const season = this._getSeason();
      const edgeUrl = season
        ? `${this._edgeUrl}?season=${encodeURIComponent(season)}`
        : this._edgeUrl;
      const res = await fetch(edgeUrl, {
        headers: {
          apikey: this._anon,
          Authorization: `Bearer ${this._anon}`,
        },
      });
      if (!res.ok) {
        const err = await res.text().catch(() => res.status);
        console.warn('[LeaderboardService] fetchTop100 failed:', res.status, err);
        return { ok: false, reason: 'server', status: res.status };
      }
      const data = await res.json();
      console.log('[LeaderboardService] fetchTop100:', data.length, 'entries');
      return { ok: true, data };
    } catch (e) {
      console.warn('[LeaderboardService] fetchTop100 error:', e);
      return { ok: false, reason: 'network' };
    }
  }

  async getLeaderboard() {
    const now = Date.now();
    const season = this._getSeason();
    if (this._cacheSeason !== season) {
      this._cache = null;
      this._cacheTime = 0;
      this._cacheSeason = season;
    }
    if (this._cache && now - this._cacheTime < CACHE_TTL) {
      return { entries: this._cache, stale: false, lastUpdated: this._cacheTime };
    }

    const result = await this.fetchTop100();
    if (result.ok) {
      if (result.data.length > 0) {
        this._cache = result.data;
        this._cacheTime = now;
        this._cacheSeason = season;
        this._storage.set(CACHE_KEY, this._cache);
        this._storage.set(CACHE_TIME_KEY, this._cacheTime);
        this._storage.set(CACHE_SEASON_KEY, this._cacheSeason);
        return { entries: this._cache, stale: false, lastUpdated: this._cacheTime };
      }
      // 서버 응답은 성공했지만 데이터 없음
      return { entries: [], stale: false, lastUpdated: now, empty: true };
    }

    if (this._cache && this._cache.length > 0) {
      return {
        entries: this._cache,
        stale: true,
        lastUpdated: this._cacheTime,
        reason: result.reason,
      };
    }
    return { entries: [], stale: false, lastUpdated: 0, offline: true, reason: result.reason };
  }

  async getMyRank(entries) {
    const myId = await this.getUserId();
    const idx = entries.findIndex(e => e.id === myId);
    return idx === -1 ? null : idx + 1;
  }

  get cachedEntries() {
    return this._cache;
  }

  get cachedTime() {
    return this._cacheTime;
  }

  _getSeason() {
    return this._levelManager?.getHiddenLeagueSeasonId?.() ?? null;
  }
}
