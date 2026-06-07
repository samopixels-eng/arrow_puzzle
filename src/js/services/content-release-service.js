const BASE_OPEN_LEVELS = 500;
const BUNDLE_SIZE = 50;
const RELEASE_INTERVAL_DAYS = 14;
const FIRST_EXTRA_RELEASE_AT = '2026-06-22T00:00:00Z';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ContentReleaseService {
  constructor({
    baseOpenLevels = BASE_OPEN_LEVELS,
    bundleSize = BUNDLE_SIZE,
    firstExtraReleaseAt = FIRST_EXTRA_RELEASE_AT,
    releaseIntervalDays = RELEASE_INTERVAL_DAYS,
  } = {}) {
    this.baseOpenLevels = baseOpenLevels;
    this.bundleSize = bundleSize;
    this.firstExtraReleaseAt = new Date(firstExtraReleaseAt).getTime();
    this.releaseIntervalMs = releaseIntervalDays * MS_PER_DAY;
  }

  getOpenLevelCount(totalLevels, now = Date.now()) {
    const total = Math.max(0, Number.isFinite(totalLevels) ? Math.trunc(totalLevels) : 0);
    if (total === 0) return 0;

    const base = Math.min(total, this.baseOpenLevels);
    if (!Number.isFinite(this.firstExtraReleaseAt) || now < this.firstExtraReleaseAt) {
      return base;
    }

    const releasedBundles = Math.floor((now - this.firstExtraReleaseAt) / this.releaseIntervalMs) + 1;
    return Math.min(total, base + releasedBundles * this.bundleSize);
  }

  getSeasonId(openLevelCount) {
    const count = Math.max(0, Number.isFinite(openLevelCount) ? Math.trunc(openLevelCount) : 0);
    return `open-${count}`;
  }
}
