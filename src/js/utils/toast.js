export function showToast(message, {
  top = '50%',
  fontFamily = 'sans-serif',
  fontSize = '15px',
  fontWeight = '600',
  padding = '16px 28px',
  borderRadius = '12px',
  background = 'rgba(0,0,0,0.85)',
  zIndex = 9999,
  duration = 2000,
  fadeMs = 300,
  maxWidth = null,
  wordBreak = null,
} = {}) {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    `top:${top}`,
    'left:50%',
    'transform:translate(-50%,-50%)',
    `background:${background}`,
    'color:#fff',
    `font-family:${fontFamily}`,
    `font-size:${fontSize}`,
    `font-weight:${fontWeight}`,
    `padding:${padding}`,
    `border-radius:${borderRadius}`,
    `z-index:${zIndex}`,
    'text-align:center',
    'pointer-events:none',
    'opacity:0',
    `transition:opacity ${fadeMs}ms`,
    maxWidth ? `max-width:${maxWidth}` : '',
    wordBreak ? `word-break:${wordBreak}` : '',
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => { toast.style.opacity = '1'; }));
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), fadeMs);
  }, duration);
}
