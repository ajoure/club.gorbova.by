/** Keep bounded app panels inside the visible viewport, without undoing pinch zoom. */
export function installAppViewport(win: Window = window) {
  const root = win.document.documentElement;
  const viewport = win.visualViewport;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Pinch zoom changes visualViewport too. Reflowing then fights the user's gesture.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height ?? win.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const editing = !!win.document.activeElement?.matches('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
    const keyboard = editing && win.innerHeight - height > 80;
    root.style.setProperty('--app-height', `${Math.round(height)}px`);
    root.style.setProperty('--visual-viewport-top', `${keyboard ? Math.max(0, viewport?.offsetTop ?? 0) : 0}px`);
    root.toggleAttribute('data-viewport-keyboard', keyboard);
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  update();
  const events = ['resize', 'orientationchange', 'pageshow'] as const;
  events.forEach(event => win.addEventListener(event, schedule));
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  win.document.addEventListener('focusin', schedule);
  win.document.addEventListener('focusout', schedule);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    events.forEach(event => win.removeEventListener(event, schedule));
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    win.document.removeEventListener('focusin', schedule);
    win.document.removeEventListener('focusout', schedule);
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--visual-viewport-top');
    root.removeAttribute('data-viewport-keyboard');
  };
}
