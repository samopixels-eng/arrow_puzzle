import { SceneRenderer } from '../scene-renderer.js';
import { applyScale } from '../utils/scaler.js';

const LOGO_SCENE_DURATION_MS = 4000;

export class LogoScreen {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this._renderer = new SceneRenderer(container, { basePath: '' });
    this._blocker = null;
    this._resizeHandler = () => this._updateScale();
  }

  async load() {
    await this._renderer.load('./js/logo.contract.json');
  }

  async show(durationMs = LOGO_SCENE_DURATION_MS) {
    this._renderer.show();

    const stage = this._renderer._el;
    stage.style.top = stage.style.right = stage.style.bottom = stage.style.left = '';
    this._updateScale();
    window.addEventListener('resize', this._resizeHandler);

    this._installInputBlocker();
    await this._sleep(durationMs);
  }

  hide() {
    window.removeEventListener('resize', this._resizeHandler);
    this._removeInputBlocker();
    this._renderer.hide();
  }

  _updateScale() {
    const stage = this._renderer._el;
    if (!stage) return;
    applyScale(stage, null, 390, 844, true);
  }

  _installInputBlocker() {
    this._removeInputBlocker();

    const blocker = document.createElement('div');
    blocker.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:100',
      'touch-action:none',
      'cursor:default',
      'background:transparent',
    ].join(';');

    const block = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    blocker._logoBlockHandler = block;
    blocker.addEventListener('pointerdown', block, { passive: false });
    blocker.addEventListener('pointerup', block, { passive: false });
    blocker.addEventListener('click', block, { passive: false });
    blocker.addEventListener('touchstart', block, { passive: false });
    blocker.addEventListener('touchend', block, { passive: false });
    this.container.appendChild(blocker);
    this._blocker = blocker;
  }

  _removeInputBlocker() {
    if (!this._blocker) return;
    const block = this._blocker._logoBlockHandler;
    if (block) {
      this._blocker.removeEventListener('pointerdown', block);
      this._blocker.removeEventListener('pointerup', block);
      this._blocker.removeEventListener('click', block);
      this._blocker.removeEventListener('touchstart', block);
      this._blocker.removeEventListener('touchend', block);
    }
    this._blocker.remove();
    this._blocker = null;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
