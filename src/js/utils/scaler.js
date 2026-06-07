/**
 * Apply scale transform to stageEl to fit within containerEl (or window).
 * @param {HTMLElement} stageEl - The fixed-size inner stage to scale
 * @param {HTMLElement|null} containerEl - The outer container (null → use window)
 * @param {number} designW - Reference width
 * @param {number} designH - Reference height
 * @param {boolean} [center=false] - If true, also set left/top 50% + translate(-50%,-50%)
 *                                   (for absolute-positioned stages like title screen)
 */
export function applyScale(stageEl, containerEl, designW, designH, center = false) {
  const w = containerEl?.clientWidth  || window.innerWidth;
  const h = containerEl?.clientHeight || window.innerHeight;
  const scale = Math.min(w / designW, h / designH);
  if (center) {
    stageEl.style.left = '50%';
    stageEl.style.top  = '50%';
    stageEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
  } else {
    stageEl.style.transform = `scale(${scale})`;
  }
}
