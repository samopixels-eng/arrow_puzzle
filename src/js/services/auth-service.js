import { SUPABASE_URL, SUPABASE_ANON } from '../constants.js';
import { getNativePlugin } from '../utils/capacitor-plugins.js';

const STORAGE_PREFIX = 'dotlink_';

export class AuthService {
  constructor({ storagePrefix = STORAGE_PREFIX } = {}) {
    this._storagePrefix = storagePrefix;
    this._deviceId = null;
    this._supportUid = null;
    this._listeners = new Set();
  }

  static isNative() {
    return !!(window.Capacitor?.isNativePlatform());
  }

  static isTestAccount() {
    return !AuthService.isNative();
  }

  // ── Device ID ──────────────────────────────────────────────────────────────

  async getDeviceId() {
    if (this._deviceId) return this._deviceId;
    if (AuthService.isNative()) {
      try {
        const Device = getNativePlugin('Device');
        if (!Device) throw new Error('Device plugin is not registered');
        const info = await Device.getId();
        this._deviceId = info.identifier;
      } catch (e) {
        console.warn('[AuthService] Device.getId failed, fallback to UUID', e);
        this._deviceId = this._getOrCreateLocalUUID();
      }
    } else {
      this._deviceId = this._getOrCreateLocalUUID();
    }
    return this._deviceId;
  }

  _getOrCreateLocalUUID() {
    let id = localStorage.getItem(this._storageKey('device_id'));
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(this._storageKey('device_id'), id);
    }
    return id;
  }

  // ── Preferences (네이티브: Capacitor Preferences / 브라우저: localStorage) ──

  async getPreference(key) {
    if (AuthService.isNative()) {
      try {
        const Preferences = getNativePlugin('Preferences');
        if (!Preferences) throw new Error('Preferences plugin is not registered');
        const { value } = await Preferences.get({ key: this._storageKey(key) });
        return value !== null ? JSON.parse(value) : null;
      } catch {}
    }
    const v = localStorage.getItem(this._storageKey(key));
    return v !== null ? JSON.parse(v) : null;
  }

  async setPreference(key, value) {
    if (AuthService.isNative()) {
      try {
        const Preferences = getNativePlugin('Preferences');
        if (!Preferences) throw new Error('Preferences plugin is not registered');
        await Preferences.set({ key: this._storageKey(key), value: JSON.stringify(value) });
      } catch {}
    }
    localStorage.setItem(this._storageKey(key), JSON.stringify(value));
  }

  _storageKey(key) {
    return `${this._storagePrefix}${key}`;
  }

  // ── User Identity ──────────────────────────────────────────────────────────

  async getUserId() {
    const socialId = await this.getPreference('social_user_id');
    if (socialId) return socialId;
    return this.getDeviceId();
  }

  async getUserName() {
    const cached = await this.getPreference('user_name');
    if (cached) return cached;
    const id = await this.getUserId();
    const name = id.replace(/-/g, '').slice(0, 8);
    await this.setPreference('user_name', name);
    await this.setPreference('user_name_source', 'auto');
    return name;
  }

  async setUserName(name, source = 'manual') {
    await this.setPreference('user_name', name);
    await this.setPreference('user_name_source', source);
  }

  async isLoggedIn() {
    return !!(await this.getPreference('social_user_id'));
  }

  async getSocialProvider() {
    return await this.getPreference('social_provider');
  }

  async getIdentityPayload() {
    return this._buildIdentityPayload();
  }

  async getSupportUid() {
    const cachedServerUid = await this.getPreference('server_support_uid');
    if (cachedServerUid) {
      const ownerId = await this.getUserId();
      this._supportUid = { ownerId, value: cachedServerUid };
      return cachedServerUid;
    }

    const ownerId = await this.getUserId();
    if (this._supportUid?.ownerId === ownerId) return this._supportUid.value;

    const links = await this._getSupportUidLinks();
    if (links[ownerId]) {
      await this._setActiveSupportUid(ownerId, links[ownerId], links);
      return links[ownerId];
    }

    const supportUid = this._buildSupportUid(ownerId);
    links[ownerId] = supportUid;
    await this._setActiveSupportUid(ownerId, supportUid, links);
    return supportUid;
  }

  async initIdentity() {
    try {
      const payload = await this._buildIdentityPayload();
      const result = await this._callIdentityFunction('identity-resolve', payload);
      if (!result?.support_uid) return null;

      await this._storeServerIdentity(result);
      return result;
    } catch (error) {
      console.warn('[AuthService] identity-resolve failed, fallback to local support uid', error);
      return null;
    }
  }

  async _getSupportUidLinks() {
    const stored = await this.getPreference('support_uid_links');
    return stored && typeof stored === 'object' ? stored : {};
  }

  async _setActiveSupportUid(ownerId, supportUid, links = null) {
    const resolvedLinks = links ?? await this._getSupportUidLinks();
    resolvedLinks[ownerId] = supportUid;
    await Promise.all([
      this.setPreference('support_uid', supportUid),
      this.setPreference('support_uid_owner', ownerId),
      this.setPreference('support_uid_links', resolvedLinks),
    ]);
    this._supportUid = { ownerId, value: supportUid };
  }

  async _buildIdentityPayload() {
    const [deviceId, providerUid, provider] = await Promise.all([
      this.getDeviceId(),
      this.getPreference('social_user_id'),
      this.getPreference('social_provider'),
    ]);
    return {
      device_id: deviceId,
      provider: provider || 'guest',
      provider_uid: providerUid,
    };
  }

  async _storeServerIdentity(result) {
    const ownerId = await this.getUserId();
    await Promise.all([
      this.setPreference('server_user_id', result.user_id ?? null),
      this.setPreference('server_support_uid', result.support_uid),
    ]);
    this._supportUid = { ownerId, value: result.support_uid };
  }

  async _callIdentityFunction(name, payload) {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error('Supabase is not configured');
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${name} failed: ${res.status} ${body}`);
    }
    return res.json();
  }

  _buildSupportUid(source) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const normalized = String(source || '').trim();
    let hash = 2166136261;

    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    let body = '';
    let value = hash >>> 0;
    for (let i = 0; i < 8; i++) {
      value = (Math.imul(value ^ (i * 97), 1597334677) + 12345) >>> 0;
      body += alphabet[value % alphabet.length];
    }

    return `DL-${body.slice(0, 4)}-${body.slice(4)}`;
  }

  // ── Social Login ───────────────────────────────────────────────────────────

  _getFirebaseAuth() {
    const plugin = window.Capacitor?.Plugins?.FirebaseAuthentication;
    if (!plugin) throw new Error('FirebaseAuthentication plugin not available');
    return plugin;
  }

  async _getCurrentFirebaseUser() {
    try {
      const result = await this._getFirebaseAuth().getCurrentUser?.();
      return result?.user ?? null;
    } catch {
      return null;
    }
  }

  async loginWithGoogle() {
    if (!AuthService.isNative()) {
      console.warn('[AuthService] 소셜 로그인은 앱에서만 가능합니다.');
      return null;
    }
    const fa = this._getFirebaseAuth();
    const bound = await this.getPreference('bound_google_user');
    const currentUser = await this._getCurrentFirebaseUser();
    if (bound?.uid && currentUser?.uid === bound.uid) {
      return this._saveSocialUser('google', {
        ...currentUser,
        displayName: currentUser.displayName || bound.displayName || '',
      });
    }

    const result = await fa.signInWithGoogle();
    if (bound?.uid && result?.user?.uid && result.user.uid !== bound.uid) {
      try {
        await fa.signOut?.();
      } catch {}
      throw new Error('This device is already linked to another Google account.');
    }
    return this._saveSocialUser('google', result.user);
  }

  async loginWithFacebook() {
    if (!AuthService.isNative()) {
      console.warn('[AuthService] 소셜 로그인은 앱에서만 가능합니다.');
      return null;
    }
    const fa = this._getFirebaseAuth();
    const result = await fa.signInWithFacebook();
    return this._saveSocialUser('facebook', result.user);
  }

  async loginWithApple() {
    if (!AuthService.isNative()) {
      console.warn('[AuthService] 소셜 로그인은 앱에서만 가능합니다.');
      return null;
    }
    const fa = this._getFirebaseAuth();
    const result = await fa.signInWithApple();
    return this._saveSocialUser('apple', result.user);
  }

  async _saveSocialUser(provider, user) {
    if (!user?.uid) {
      throw new Error(`${provider} login completed without a Firebase user`);
    }

    const [previousOwnerId, currentSupportUid, links] = await Promise.all([
      this.getUserId(),
      this.getPreference('support_uid'),
      this._getSupportUidLinks(),
    ]);

    await this.setPreference('social_user_id', user.uid);
    await this.setPreference('social_provider', provider);
    await this.setPreference('server_user_id', null);
    await this.setPreference('server_support_uid', null);
    await this.applySocialDisplayName(user.displayName);
    if (provider === 'google') {
      await this.setPreference('bound_google_user', {
        uid: user.uid,
        displayName: user.displayName ?? '',
      });
    }

    if (links[user.uid]) {
      await this._setActiveSupportUid(user.uid, links[user.uid], links);
    } else if (currentSupportUid) {
      if (previousOwnerId) links[previousOwnerId] = currentSupportUid;
      await this._setActiveSupportUid(user.uid, currentSupportUid, links);
    } else {
      const supportUid = this._buildSupportUid(user.uid);
      await this._setActiveSupportUid(user.uid, supportUid, links);
    }

    try {
      const deviceId = await this.getDeviceId();
      const result = await this._callIdentityFunction('identity-link', {
        device_id: deviceId,
        provider,
        provider_uid: user.uid,
      });
      if (result?.support_uid) {
        await this._storeServerIdentity(result);
      }
    } catch (error) {
      console.warn('[AuthService] identity-link failed, retry identity-resolve', error);
      await this.initIdentity();
    }

    const info = { uid: user.uid, displayName: user.displayName ?? '', provider };
    this._notify(info);
    return info;
  }

  async applySocialDisplayName(displayName) {
    const name = String(displayName || '').trim();
    if (!name) return false;

    const source = await this.getPreference('user_name_source');
    if (source === 'manual') return false;

    await this.setUserName(name, 'social');
    return true;
  }

  async logout({ keepNativeSession = null } = {}) {
    const provider = await this.getSocialProvider();
    const shouldKeepNativeSession = keepNativeSession ?? provider === 'google';
    if (AuthService.isNative() && !shouldKeepNativeSession) {
      try {
        await this._getFirebaseAuth().signOut();
      } catch {}
    }
    await this.setPreference('social_user_id', null);
    await this.setPreference('social_provider', null);
    await this.setPreference('server_user_id', null);
    await this.setPreference('server_support_uid', null);
    this._supportUid = null;
    this._notify(null);
  }

  onAuthStateChanged(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _notify(user) {
    this._listeners.forEach(cb => cb(user));
  }
}
