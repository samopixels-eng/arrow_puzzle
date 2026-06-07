import { StorageService } from './storage-service.js';

const STORAGE_KEY = 'hearts';
const MAX_HEARTS  = 5;
const REGEN_MS    = 30 * 60 * 1000; // 30분

export class HeartService {
  constructor({ storage = new StorageService() } = {}) {
    this._storage   = storage;
    this._listeners = [];
    this._tick();
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────────

  _load() {
    return this._storage.get(STORAGE_KEY, { count: MAX_HEARTS, lastRegenTime: Date.now() });
  }

  _save(data) {
    this._storage.set(STORAGE_KEY, data);
  }

  /** 경과 시간 기반 자동 충전 계산 */
  _tick() {
    const data = this._load();
    if (data.count >= MAX_HEARTS) return;

    const elapsed = Date.now() - data.lastRegenTime;
    const gained  = Math.floor(elapsed / REGEN_MS);
    if (gained <= 0) return;

    data.count = Math.min(MAX_HEARTS, data.count + gained);
    data.lastRegenTime += gained * REGEN_MS;
    this._save(data);
  }

  // ── 공개 API ─────────────────────────────────────────────────────────────────

  getCount() {
    this._tick();
    return this._load().count;
  }

  getState() {
    this._tick();
    return this._load();
  }

  setState(state) {
    const next = state && typeof state === 'object' ? state : {};
    const count = Math.max(0, Math.min(MAX_HEARTS, Math.trunc(next.count ?? MAX_HEARTS)));
    this._save({
      count,
      lastRegenTime: Number.isFinite(next.lastRegenTime) ? next.lastRegenTime : Date.now(),
    });
    this._notify();
  }

  /** 다음 재충전까지 남은 ms. 최대치면 0 반환. */
  getNextRegenMs() {
    this._tick();
    const data = this._load();
    if (data.count >= MAX_HEARTS) return 0;
    return Math.max(0, REGEN_MS - (Date.now() - data.lastRegenTime));
  }

  isFull() {
    return this.getCount() >= MAX_HEARTS;
  }

  canPlay() {
    return this.getCount() > 0;
  }

  /** 하트 1개 소모. 성공 시 true 반환. */
  consume() {
    this._tick();
    const data = this._load();
    if (data.count <= 0) return false;

    // 최대치에서 처음 차감될 때 재충전 타이머 리셋
    if (data.count === MAX_HEARTS) {
      data.lastRegenTime = Date.now();
    }
    data.count--;
    this._save(data);
    this._notify();
    return true;
  }

  /** 하트를 MAX_HEARTS(5)로 즉시 충전 */
  refillFull() {
    this._tick();
    const data = this._load();
    if (data.count >= MAX_HEARTS) return;
    data.count = MAX_HEARTS;
    this._save(data);
    this._notify();
  }

  /** 클리어 시 하트 1개 복구 */
  restore() {
    this._tick();
    const data = this._load();
    if (data.count >= MAX_HEARTS) return;
    data.count++;
    // 최대치 도달 시 타이머 의미 없음 — lastRegenTime 초기화 불필요
    this._save(data);
    this._notify();
  }

  /** 변화 구독. 반환값은 구독 해제 함수. */
  onChange(cb) {
    this._listeners.push(cb);
    return () => { this._listeners = this._listeners.filter(l => l !== cb); };
  }

  _notify() {
    const count = this.getCount();
    for (const cb of this._listeners) cb(count);
  }
}
