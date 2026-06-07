import { ArrowPuzzleScreen } from "../screens/arrow-puzzle-screen.js";
import { ARROW_PUZZLE_GAME_CONFIG } from "./arrow-puzzle-game-config.js";

export function createArrowPuzzleGameAdapter(config = ARROW_PUZZLE_GAME_CONFIG) {
  return new ArrowPuzzleGameAdapter(config);
}

class ArrowPuzzleGameAdapter {
  constructor(config) {
    this.config = config;
  }

  createGameScreen(container, callbacks) {
    return new ArrowPuzzleScreen(container, callbacks);
  }

  async showGameScreen(screen, {
    level,
    stageLabel,
    services,
    options = {},
  }) {
    return screen.show(
      level,
      stageLabel,
      services.soundService,
      services.adService,
      services.coinService,
      services.itemService,
      options,
    );
  }

  getLevelDisplayLabel(levelManager) {
    return String(levelManager?.getCurrentLevelNumber?.() ?? 1);
  }

  shouldReturnToLobbyAfterClear({ clearedStage }) {
    return clearedStage >= this.config.flow.returnToLobbyAfterStage;
  }
}
