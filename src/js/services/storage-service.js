const PREFIX = 'dotlink_';

export class StorageService {
  constructor({ prefix = PREFIX } = {}) {
    this._prefix = prefix;
  }

  get(key, defaultValue = null) {
    try {
      const val = localStorage.getItem(this._key(key));
      return val !== null ? JSON.parse(val) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  set(key, value) {
    try {
      localStorage.setItem(this._key(key), JSON.stringify(value));
    } catch {}
  }

  remove(key) {
    try {
      localStorage.removeItem(this._key(key));
    } catch {}
  }

  _key(key) {
    return `${this._prefix}${key}`;
  }
}
