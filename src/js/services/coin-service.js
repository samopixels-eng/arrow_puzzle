import { StorageService } from './storage-service.js';

const STORAGE_KEY = 'coins';

export class CoinService {
  constructor({ storage = new StorageService() } = {}) {
    this._storage = storage;
    this._coins = this._storage.get(STORAGE_KEY, 0);
    this._listeners = [];
  }

  getCoins() {
    return this._coins;
  }

  add(amount) {
    this._coins += amount;
    this._storage.set(STORAGE_KEY, this._coins);
    this._notify();
  }

  setCoins(amount) {
    this._coins = Math.max(0, Number.isFinite(amount) ? Math.trunc(amount) : 0);
    this._storage.set(STORAGE_KEY, this._coins);
    this._notify();
  }

  spend(amount) {
    if (this._coins < amount) return false;
    this._coins -= amount;
    this._storage.set(STORAGE_KEY, this._coins);
    this._notify();
    return true;
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  _notify() {
    this._listeners.forEach(fn => fn(this._coins));
  }
}
