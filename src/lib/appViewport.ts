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
    // В установленном веб-приложении на iPhone клавиатура может «съедать» меньше
    // высоты и сдвигать страницу вверх, поэтому учитываем и смещение.
    const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
    const keyboard = editing && (win.innerHeight - height > 60 || offsetTop > 20);
    const setGeometry = (name: string, value: string) => {
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    };
    setGeometry('--app-height', `${Math.round(height)}px`);
    setGeometry('--visual-viewport-top', `${keyboard ? Math.round(offsetTop) : 0}px`);
    if (root.hasAttribute('data-viewport-keyboard') !== keyboard) {
      root.toggleAttribute('data-viewport-keyboard', keyboard);
    }
    // Never reset document scrolling here: Safari pans it to keep the caret
    // visible. Undoing that inside visualViewport.scroll creates a feedback loop.
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
