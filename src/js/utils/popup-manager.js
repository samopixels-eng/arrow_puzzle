const DEFAULT_DURATION = 300;
const DEFAULT_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function createScalePopupFrame({ dimOpacity = 0.55, zIndex = 2000 } = {}) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position:fixed', 'inset:0', `z-index:${zIndex}`,
    'display:none', 'align-items:center', 'justify-content:center',
    `background:rgba(0,0,0,${dimOpacity})`,
  ].join(';');
  document.body.appendChild(wrapper);

  const inner = document.createElement('div');
  inner.style.cssText = [
    'position:absolute', 'inset:0',
    'transform:scale(0)', 'transform-origin:center center',
    `transition:transform ${DEFAULT_DURATION}ms ${DEFAULT_EASING}`,
  ].join(';');
  wrapper.appendChild(inner);

  return { wrapper, inner };
}

export function openScalePopup(wrapper, inner) {
  if (wrapper._closeTimer) {
    clearTimeout(wrapper._closeTimer);
    wrapper._closeTimer = null;
  }
  wrapper.style.display = 'flex';
  inner.style.transform = 'scale(0)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    inner.style.transform = 'scale(1)';
  }));
}

export function closeScalePopup(wrapper, inner, duration = DEFAULT_DURATION) {
  inner.style.transform = 'scale(0)';
  if (wrapper._closeTimer) clearTimeout(wrapper._closeTimer);
  wrapper._closeTimer = setTimeout(() => {
    wrapper.style.display = 'none';
    wrapper._closeTimer = null;
  }, duration);
}

export class PopupManager {
  constructor(element, {
    root,
    duration = DEFAULT_DURATION,
    easing   = DEFAULT_EASING,
    hasDim   = true,
    dimZIndex = 90,
    zIndex   = 100,
  } = {}) {
    this._el       = element;
    this._root     = root || element.parentElement;
    this._duration = duration;
    this._dimEl    = null;
    this._closeTimer = null;

    this._init(zIndex, dimZIndex, easing, hasDim);
  }

  _init(zIndex, dimZIndex, easing, hasDim) {
    this._root.appendChild(this._el);

    this._el.style.display    = 'none';
    this._el.style.transform  = 'scale(0)';
    this._el.style.transition = `transform ${this._duration}ms ${easing}`;
    this._el.style.zIndex     = String(zIndex);

    if (hasDim) {
      this._dimEl = document.createElement('div');
      this._dimEl.style.cssText =
        `position:absolute;inset:0;background:rgba(0,0,0,0.55);display:none;z-index:${dimZIndex};`;
      this._root.insertBefore(this._dimEl, this._el);
    }
  }

  open() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    if (this._dimEl) this._dimEl.style.display = '';
    this._el.style.display   = '';
    // ui-editor에서 팝업 레이어는 visible:false(display:none)로 저장되는 경우가 많아
    // 그룹 wrapper를 보이게 해도 자식 레이어들이 숨겨진 채로 남는다. 여기서 일괄 해제한다.
    this._el.querySelectorAll('[data-stable-id]').forEach(el => { el.style.display = ''; });
    this._el.style.transform = 'scale(0)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this._el.style.transform = 'scale(1)';
    }));
  }

  close() {
    this._el.style.transform = 'scale(0)';
    if (this._dimEl) this._dimEl.style.display = 'none';
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this._el.style.display = 'none';
      this._closeTimer = null;
    }, this._duration);
  }

  destroy() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    if (this._dimEl) {
      this._dimEl.remove();
      this._dimEl = null;
    }
  }
}
