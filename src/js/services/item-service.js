import { StorageService } from './storage-service.js';

const STORAGE_KEY = 'items';

/** 아이템 종류별 초기 보유 수량 */
const DEFAULTS = {
  hint:       3,
  hammer:     3,
  timer:      3,
  resetboard: 3,
  time30:     3,
};

/**
 * 아이템 수량 관리 서비스 (localStorage 기반, 단일 기기).
 * 멀티기기 동기화가 필요해지면 백엔드 DB로 마이그레이션.
 */
export class ItemService {
  constructor({ storage = new StorageService() } = {}) {
    this._storage  = storage;
    this._items    = { ...DEFAULTS, ...this._storage.get(STORAGE_KEY, {}) };
    this._listeners = {}; // type → Function[]
  }

  /** 아이템 수량 조회 */
  getCount(type) {
    return this._items[type] ?? 0;
  }

  /**
   * 아이템 1개 사용. 수량이 0이면 false 반환.
   * @returns {boolean}
   */
  use(type) {
    if ((this._items[type] ?? 0) <= 0) return false;
    this._items[type]--;
    this._save();
    this._notify(type);
    return true;
  }

  /** 아이템 수량 추가 (상점 구매 등) */
  add(type, amount = 1) {
    this._items[type] = (this._items[type] ?? 0) + amount;
    this._save();
    this._notify(type);
  }

  getAll() {
    return { ...this._items };
  }

  setAll(items) {
    this._items = { ...DEFAULTS, ...(items && typeof items === 'object' ? items : {}) };
    this._save();
    Object.keys(this._items).forEach(type => this._notify(type));
  }

  /**
   * 특정 아이템 수량 변화 구독.
   * @returns {() => void} 구독 해제 함수
   */
  onChange(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
    return () => {
      this._listeners[type] = this._listeners[type].filter(f => f !== fn);
    };
  }

  _save() {
    this._storage.set(STORAGE_KEY, this._items);
  }

  _notify(type) {
    (this._listeners[type] || []).forEach(fn => fn(this._items[type]));
  }
}
