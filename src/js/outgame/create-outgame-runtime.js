import { LevelManager } from '../engine/level-manager.js';
import { SoundService } from '../services/sound-service.js';
import { AdService } from '../services/ad-service.js';
import { CoinService } from '../services/coin-service.js';
import { ItemService } from '../services/item-service.js';
import { HeartService } from '../services/heart-service.js';
import { StorageService } from '../services/storage-service.js';
import { LeaderboardService } from '../services/leaderboard-service.js';
import { AuthService } from '../services/auth-service.js';
import { PlayerStatsService } from '../services/player-stats-service.js';
import { CloudSaveService } from '../services/cloud-save-service.js';
import { PurchaseService } from '../services/purchase-service.js';
import { SUPABASE_URL, SUPABASE_ANON } from '../constants.js';

export function createOutgameRuntime({
  config,
  gameAdapter,
  levelManager,
  supabaseUrl = SUPABASE_URL,
  supabaseAnon = SUPABASE_ANON,
} = {}) {
  if (!config) {
    throw new Error('createOutgameRuntime requires a game config.');
  }
  if (!gameAdapter) {
    throw new Error('createOutgameRuntime requires a game adapter.');
  }

  const storageService = new StorageService({ prefix: config.storagePrefix });
  const resolvedLevelManager = levelManager ?? new LevelManager(undefined, {
    storagePrefix: config.storagePrefix,
  });
  const soundService = new SoundService({ storagePrefix: config.storagePrefix });
  const adService = new AdService();
  const coinService = new CoinService({ storage: storageService });
  const itemService = new ItemService({ storage: storageService });
  const heartService = new HeartService({ storage: storageService });
  const authService = new AuthService({ storagePrefix: config.storagePrefix });
  const leaderboardService = new LeaderboardService(supabaseUrl, supabaseAnon, authService, {
    levelManager: resolvedLevelManager,
    storage: storageService,
  });
  const statsService = new PlayerStatsService(authService, leaderboardService);
  const cloudSaveService = new CloudSaveService(supabaseUrl, supabaseAnon, {
    authService,
    levelManager: resolvedLevelManager,
    coinService,
    itemService,
    heartService,
    statsService,
    storage: storageService,
  });
  const purchaseService = new PurchaseService({
    authService,
    coinService,
    itemService,
    cloudSaveService,
  });

  return {
    gameConfig: config,
    gameAdapter,
    storageService,
    levelManager: resolvedLevelManager,
    soundService,
    adService,
    coinService,
    itemService,
    heartService,
    authService,
    leaderboardService,
    statsService,
    cloudSaveService,
    purchaseService,
  };
}
