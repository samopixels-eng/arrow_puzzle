export class PlayerStatsService {
  constructor(authService, leaderboardService) {
    this._auth = authService;
    this._lb   = leaderboardService;
    this._listeners = [];
  }

  async getStats() {
    const s = await this._auth.getPreference('player_stats');
    return this._normalizeStats(s);
  }

  async beginStageAttempt(stageKey) {
    if (!stageKey) return { firstTry: true };
    const firstTry = await this.isFirstTry(stageKey);
    await this._auth.setPreference('active_stage_attempt', {
      stageKey,
      started_at: new Date().toISOString(),
    });
    return { firstTry };
  }

  async completeStageAttempt(stageKey) {
    const firstTry = await this.isFirstTry(stageKey);
    await this._clearActiveAttempt(stageKey);
    await this.recordWin({ firstTry });
    return { firstTry };
  }

  async abandonStageAttempt(stageKey) {
    const active = await this._auth.getPreference('active_stage_attempt');
    const key = stageKey || active?.stageKey || null;
    await this._clearActiveAttempt(key);
    await this.recordDefeat({ stageKey: key });
  }

  async resolveInterruptedAttempt() {
    const active = await this._auth.getPreference('active_stage_attempt');
    if (!active?.stageKey) return false;
    await this._clearActiveAttempt(active.stageKey);
    await this.recordDefeat({ stageKey: active.stageKey });
    return true;
  }

  async isFirstTry(stageKey) {
    if (!stageKey) return true;
    const s = await this.getStats();
    return !s.stage_attempt_failures?.[stageKey];
  }

  async recordWin({ firstTry = true } = {}) {
    const s = await this.getStats();
    if (firstTry) s.first_try++;
    s.current_streak++;
    if (s.current_streak > s.max_streak) s.max_streak = s.current_streak;
    await this._auth.setPreference('player_stats', s);
    this._notify();
  }

  async recordDefeat({ stageKey } = {}) {
    const s = await this.getStats();
    s.current_streak = 0;
    if (stageKey) {
      s.stage_attempt_failures[stageKey] = true;
      this._trimAttemptFailures(s.stage_attempt_failures);
    }
    await this._auth.setPreference('player_stats', s);
    this._notify();
  }

  async getFlag() {
    const stored = await this._auth.getPreference('player_flags');
    if (stored) return stored;
    const detected = this._lb?.detectCountry?.() || null;
    const code = detected || 'US';
    await this._auth.setPreference('player_flags', code);
    return code;
  }

  async setFlag(code) {
    await this._auth.setPreference('player_flags', code.toUpperCase());
    this._notify();
  }

  async getName() {
    return this._auth.getUserName();
  }

  async setName(name) {
    if (this._auth.setUserName) {
      await this._auth.setUserName(name, 'manual');
    } else {
      await this._auth.setPreference('user_name', name);
    }
    this._notify();
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  _notify() {
    this._listeners.forEach(fn => fn());
  }

  _normalizeStats(stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    return {
      ...s,
      first_try: Number.isFinite(s.first_try) ? Math.max(0, Math.trunc(s.first_try)) : 0,
      current_streak: Number.isFinite(s.current_streak) ? Math.max(0, Math.trunc(s.current_streak)) : 0,
      max_streak: Number.isFinite(s.max_streak) ? Math.max(0, Math.trunc(s.max_streak)) : 0,
      stage_attempt_failures: s.stage_attempt_failures && typeof s.stage_attempt_failures === 'object'
        ? { ...s.stage_attempt_failures }
        : {},
    };
  }

  async _clearActiveAttempt(stageKey) {
    const active = await this._auth.getPreference('active_stage_attempt');
    if (!active || (stageKey && active.stageKey !== stageKey)) return;
    await this._auth.setPreference('active_stage_attempt', null);
  }

  _trimAttemptFailures(failures) {
    const keys = Object.keys(failures);
    if (keys.length <= 300) return;
    keys.slice(0, keys.length - 300).forEach(key => delete failures[key]);
  }
}
