import { StorageService } from './storage-service.js';
import { AuthService } from './auth-service.js';

const DIRTY_KEY = 'cloud_save_dirty';
const LAST_SYNC_KEY = 'cloud_save_last_sync';
const PRE_SOCIAL_SNAPSHOT_KEY = 'pre_social_login_snapshot';
const PRE_SOCIAL_HAS_LOCAL_KEY = 'pre_social_login_has_local';
const STATE_VERSION = 2;
const DEFAULT_ITEMS = {
  hint: 3,
  hammer: 3,
  timer: 3,
  resetboard: 3,
  time30: 3,
};
const MAX_HEARTS = 5;

export class CloudSaveService {
  constructor(supabaseUrl, supabaseAnon, {
    authService,
    levelManager,
    coinService,
    itemService,
    heartService,
    statsService,
    storage,
  } = {}) {
    this._url = (supabaseUrl || '').replace(/\/$/, '');
    this._anon = supabaseAnon || '';
    this._auth = authService;
    this._levelManager = levelManager;
    this._coinService = coinService;
    this._itemService = itemService;
    this._heartService = heartService;
    this._statsService = statsService;
    this._storage = storage ?? new StorageService();
    this._unsubs = [];
    this._syncing = false;
  }

  get _ready() {
    return !!(this._url && this._anon && this._auth);
  }

  get _edgeUrl() {
    return `${this._url}/functions/v1/player-state`;
  }

  watchLocalChanges() {
    this._unsubs.forEach(unsub => unsub());
    this._unsubs = [];

    const mark = () => this.markDirty();
    this._unsubs.push(this._levelManager?.onChange?.(mark));
    this._unsubs.push(this._coinService?.onChange?.(mark));
    this._unsubs.push(this._heartService?.onChange?.(mark));
    this._unsubs.push(this._statsService?.onChange?.(mark));

    const itemTypes = Object.keys(this._itemService?.getAll?.() ?? {});
    itemTypes.forEach(type => this._unsubs.push(this._itemService?.onChange?.(type, mark)));

    this._unsubs = this._unsubs.filter(Boolean);
  }

  markDirty() {
    this._storage.set(DIRTY_KEY, true);
  }

  markClean() {
    this._storage.set(DIRTY_KEY, false);
    this._storage.set(LAST_SYNC_KEY, Date.now());
  }

  isDirty() {
    return !!this._storage.get(DIRTY_KEY, false);
  }

  async restoreIfLoggedIn() {
    if (!this._ready || !(await this._auth.isLoggedIn())) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    const result = await this._call('get');
    if (!result?.state) return false;

    await this.applySnapshot(result.state);
    this.markClean();
    return true;
  }

  async rememberLocalBeforeSocialLogin() {
    const snapshot = await this.createSnapshot();
    this._storage.set(PRE_SOCIAL_SNAPSHOT_KEY, snapshot);
    this._storage.set(PRE_SOCIAL_HAS_LOCAL_KEY, this._hasMeaningfulLocalState(snapshot));
  }

  async restoreLocalAfterSocialLogout() {
    return this.resetLocalAfterSocialLogout();
  }

  async resetLocalAfterSocialLogout() {
    this._storage.remove(PRE_SOCIAL_SNAPSHOT_KEY);
    this._storage.remove(PRE_SOCIAL_HAS_LOCAL_KEY);

    this._levelManager?.setProgressIndex?.(0);
    this._levelManager?.setHiddenLeagueState?.({ season: '', progress: 0, point: 0 });
    this._coinService?.setCoins?.(0);
    this._itemService?.setAll?.(DEFAULT_ITEMS);
    this._heartService?.setState?.({ count: MAX_HEARTS, lastRegenTime: Date.now() });

    await Promise.all([
      this._auth?.setPreference?.('player_stats', null),
      this._auth?.setPreference?.('active_stage_attempt', null),
      this._auth?.setPreference?.('player_flags', null),
      this._auth?.setPreference?.('user_name', null),
      this._auth?.setPreference?.('user_name_source', null),
    ]);

    this.markClean();
    return true;
  }

  async syncOnStartup() {
    if (!(await this._auth?.isLoggedIn?.())) return false;
    if (this.isDirty()) return this.uploadNow();
    return this.restoreIfLoggedIn();
  }

  async syncIfNeeded() {
    if (!this.isDirty()) return false;
    return this.uploadNow();
  }

  async uploadNow() {
    if (!this._ready || this._syncing) return false;
    if (!(await this._auth.isLoggedIn())) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.markDirty();
      return false;
    }

    this._syncing = true;
    try {
      const snapshot = await this.createSnapshot();
      await this._call('upsert', {
        state: snapshot,
        client_updated_at: snapshot.saved_at,
      });
      this.markClean();
      return true;
    } catch (e) {
      console.warn('[CloudSaveService] upload failed:', e);
      this.markDirty();
      return false;
    } finally {
      this._syncing = false;
    }
  }

  async createSnapshot() {
    const [stats, flag, name, nameSource, entitlements, hasAnyPurchase] = await Promise.all([
      this._statsService?.getStats?.(),
      this._auth.getPreference('player_flags'),
      this._auth.getPreference('user_name'),
      this._auth.getPreference('user_name_source'),
      this._auth.getPreference('entitlements'),
      this._auth.getPreference('has_any_purchase'),
    ]);

    return {
      version: STATE_VERSION,
      current_level_index: this._levelManager?.currentIndex ?? 0,
      hidden_league: this._levelManager?.getHiddenLeagueState?.() ?? null,
      coins: this._coinService?.getCoins?.() ?? 0,
      items: this._itemService?.getAll?.() ?? {},
      hearts: this._heartService?.getState?.() ?? null,
      player_stats: stats ?? null,
      player_flags: flag ?? null,
      user_name: name ?? null,
      user_name_source: nameSource ?? null,
      entitlements: entitlements ?? {},
      has_any_purchase: !!hasAnyPurchase,
      is_test: AuthService.isTestAccount(),
      saved_at: new Date().toISOString(),
    };
  }

  async applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;

    if (Number.isFinite(snapshot.current_level_index)) {
      this._levelManager?.setProgressIndex?.(snapshot.current_level_index);
    }
    if (snapshot.hidden_league && typeof snapshot.hidden_league === 'object') {
      this._levelManager?.setHiddenLeagueState?.(snapshot.hidden_league);
    }
    if (Number.isFinite(snapshot.coins)) {
      this._coinService?.setCoins?.(snapshot.coins);
    }
    if (snapshot.items && typeof snapshot.items === 'object') {
      this._itemService?.setAll?.(snapshot.items);
    }
    if (snapshot.hearts && typeof snapshot.hearts === 'object') {
      this._heartService?.setState?.(snapshot.hearts);
    }
    if (snapshot.player_stats && typeof snapshot.player_stats === 'object') {
      await this._auth.setPreference('player_stats', snapshot.player_stats);
    }
    if (snapshot.player_flags) {
      await this._auth.setPreference('player_flags', snapshot.player_flags);
    }
    if (snapshot.user_name) {
      await this._auth.setPreference('user_name', snapshot.user_name);
    }
    if (snapshot.user_name_source) {
      await this._auth.setPreference('user_name_source', snapshot.user_name_source);
    }
    if (snapshot.entitlements && typeof snapshot.entitlements === 'object') {
      await this._auth.setPreference('entitlements', snapshot.entitlements);
    }
    if ('has_any_purchase' in snapshot) {
      await this._auth.setPreference('has_any_purchase', !!snapshot.has_any_purchase);
    }
  }

  _hasMeaningfulLocalState(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if ((snapshot.current_level_index ?? 0) > 0) return true;
    if ((snapshot.hidden_league?.point ?? 0) > 0 || (snapshot.hidden_league?.progress ?? 0) > 0) return true;
    if ((snapshot.coins ?? 0) > 0) return true;

    const items = snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    if (Object.keys(DEFAULT_ITEMS).some(type => (items[type] ?? 0) !== DEFAULT_ITEMS[type])) {
      return true;
    }

    const hearts = snapshot.hearts && typeof snapshot.hearts === 'object' ? snapshot.hearts : {};
    if ((hearts.count ?? MAX_HEARTS) !== MAX_HEARTS) return true;

    const stats = snapshot.player_stats && typeof snapshot.player_stats === 'object'
      ? snapshot.player_stats
      : {};
    return (stats.first_try ?? 0) > 0
      || (stats.current_streak ?? 0) > 0
      || (stats.max_streak ?? 0) > 0;
  }

  async _call(action, extra = {}) {
    const identity = await this._auth.getIdentityPayload();
    const res = await fetch(this._edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this._anon,
        Authorization: `Bearer ${this._anon}`,
      },
      body: JSON.stringify({ action, ...identity, ...extra }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`player-state ${action} failed: ${res.status} ${body}`);
    }
    return res.json();
  }
}
