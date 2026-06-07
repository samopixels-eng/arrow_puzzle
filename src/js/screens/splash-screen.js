import { SceneRenderer } from '../scene-renderer.js';
import { applyScale } from '../utils/scaler.js';

// splash.contract.json 로딩바 프레임 기준치 (hp-bar-frame-16: 180x28, border 2px)
// 내부 여백 4px 적용 → 최대 채움 너비 172px, 높이 20px
const FILL_MAX_W = 172;
const FILL_H     = 20;
const FILL_PAD   = 4;

export class SplashScreen {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this._renderer = new SceneRenderer(container, { basePath: '' });
    this._fillEl        = null;
    this._blinkTimer    = null;
    this._resizeHandler = () => this._updateScale();
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  async load() {
    await this._renderer.load('./js/splash.contract.json');
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * 스플래시 화면 표시 + 로딩 실행.
   * @param {Array<{ run: () => Promise<void> }>} tasks - 순서대로 실행할 로딩 작업들
   */
  async show(tasks, { onTouchToStart } = {}) {
    // CSS: .visible → opacity 1
    if (!document.getElementById('splash-visible-css')) {
      const s = document.createElement('style');
      s.id = 'splash-visible-css';
      s.textContent = `#splash.visible { opacity: 1 !important; }`;
      document.head.appendChild(s);
    }

    this._renderer.show();

    // inset:0 제거 후 중앙 정렬+스케일
    const stage = this._renderer._el;
    stage.style.top = stage.style.right = stage.style.bottom = stage.style.left = '';
    this._updateScale();
    window.addEventListener('resize', this._resizeHandler);

    // 다음 프레임에서 DOM 계산 가능
    await new Promise(r => requestAnimationFrame(r));

    this._initFillBar();
    this._setProgress(0);
    this._hideTouchToStart();

    // 로딩 태스크 순차 실행
    const total = tasks.length;
    for (let i = 0; i < total; i++) {
      await tasks[i].run();
      this._setProgress((i + 1) / total);
      await new Promise(r => setTimeout(r, 120)); // 진행바 애니메이션 여유
    }

    // 100% 완료 후 잠깐 대기
    await new Promise(r => setTimeout(r, 350));

    // Touch to Start 표시 + 깜빡임
    await this._showTouchToStart();

    // 아무 터치/클릭 대기 → Promise resolve
    await this._waitForTap(onTouchToStart);
  }

  hide() {
    window.removeEventListener('resize', this._resizeHandler);
    if (this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; }
    this._renderer.hide();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _updateScale() {
    const stage = this._renderer._el;
    if (!stage) return;
    applyScale(stage, null, 390, 844, true);
  }

  _initFillBar() {
    const frameEl = this._renderer.getElement('hp-bar-frame-16');
    if (!frameEl) return;
    const inner = frameEl.firstElementChild;
    if (!inner) return;

    // inner 기준으로 절대 배치 가능하도록
    inner.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.style.cssText = [
      'position:absolute',
      `left:${FILL_PAD}px`,
      `top:${FILL_PAD}px`,
      'width:0px',
      `height:${FILL_H}px`,
      'border-radius:10px',
      'background:linear-gradient(90deg,#64b5f6,#1565c0)',
      'box-shadow:0 0 10px rgba(21,101,192,0.8)',
      'transition:width 0.35s ease',
      'pointer-events:none',
    ].join(';');

    inner.appendChild(fill);
    this._fillEl = fill;
  }

  _setProgress(ratio) {
    if (!this._fillEl) return;
    const w = Math.round(FILL_MAX_W * Math.max(0, Math.min(1, ratio)));
    this._fillEl.style.width = w + 'px';
  }

  _hideTouchToStart() {
    const el = this._renderer.getElement('leaderboard-title-1');
    if (el) {
      el.style.opacity    = '0';
      el.style.transition = 'opacity 0.7s ease';
    }
  }

  async _showTouchToStart() {
    const el = this._renderer.getElement('leaderboard-title-1');
    if (!el) return;

    // 페이드인
    el.style.opacity = '1';
    await new Promise(r => setTimeout(r, 700));

    // 깜빡임
    let bright = true;
    this._blinkTimer = setInterval(() => {
      bright = !bright;
      el.style.opacity = bright ? '1' : '0.2';
    }, 650);
  }

  _waitForTap(onTouchToStart) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:50;cursor:pointer;';
      this.container.appendChild(overlay);

      const done = () => {
        onTouchToStart?.();
        overlay.remove();
        if (this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; }
        resolve();
      };
      overlay.addEventListener('click',    done, { once: true });
      overlay.addEventListener('touchend', done, { once: true });
    });
  }
}
