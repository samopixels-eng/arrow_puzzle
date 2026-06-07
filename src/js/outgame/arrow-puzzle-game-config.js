export const ARROW_PUZZLE_GAME_CONFIG = Object.freeze({
  gameId: "arrow_puzzle",
  storagePrefix: "arrow_puzzle_",
  debugLogPrefix: "[ARROW_PUZZLE_DEBUG]",
  flow: Object.freeze({
    returnToLobbyAfterStage: 15
  })
});

if (typeof window !== "undefined") {
  window.ARROW_PUZZLE_OUTGAME_CONFIG = ARROW_PUZZLE_GAME_CONFIG;
}
