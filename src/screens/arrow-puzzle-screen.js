export class ArrowPuzzleScreen {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this._active = false;
    this._shell = null;
  }

  async show(level, stageLabel, soundService, adService, coinService, itemService, options = {}) {
    const api = this._getApi();
    const levelIndex = this._resolveLevelIndex(level, options);
    this._showShell();

    this._active = true;
    api.setOutgameMode?.(true);
    api.setCallbacks?.({
      onClear: (stats = {}) => {
        if (!this._active) return;
        this.callbacks.onClear?.({
          ...stats,
          levelLabel: stageLabel,
        });
      },
      onLeave: () => {
        if (!this._active) return;
        this.callbacks.onLeave?.();
      },
    });

    const loaded = api.loadLevelIndex
      ? api.loadLevelIndex(levelIndex)
      : api.loadLevel(levelIndex + 1);

    if (!loaded) {
      throw new Error(`ArrowPuzzleScreen failed to load level index ${levelIndex}.`);
    }

    return true;
  }

  hide() {
    if (!this._active) return;
    this._active = false;
    const api = window.arrowPuzzle;
    api?.setCallbacks?.({});
    api?.setOutgameMode?.(false);
    this._hideShell();
  }

  _showShell() {
    const shell = document.querySelector(".app-shell");
    if (!shell) {
      throw new Error("ArrowPuzzleScreen requires an .app-shell element.");
    }
    this._shell = shell;
    if (shell.parentElement !== this.container) {
      this.container.appendChild(shell);
    }
    shell.style.display = "flex";
    shell.style.width = "100%";
    shell.style.height = "100%";
  }

  _hideShell() {
    if (!this._shell) return;
    this._shell.style.display = "none";
  }

  _resolveLevelIndex(level, options) {
    if (Number.isFinite(options.levelIndex)) {
      return Math.max(0, Math.trunc(options.levelIndex));
    }
    if (Number.isFinite(level?.__outgameIndex)) {
      return Math.max(0, Math.trunc(level.__outgameIndex));
    }
    const state = window.arrowPuzzle?.getState?.();
    return Math.max(0, Math.trunc((state?.levelNumber ?? 1) - 1));
  }

  _getApi() {
    const api = window.arrowPuzzle;
    if (!api) {
      throw new Error("window.arrowPuzzle is not available. Load src/main.js before ArrowPuzzleScreen.show().");
    }
    return api;
  }
}
