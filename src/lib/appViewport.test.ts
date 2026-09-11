import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppViewport } from './appViewport';

describe('visible app viewport', () => {
  let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
  let dispose: (() => void) | undefined;
  let pending: FrameRequestCallback | undefined;
  const flush = () => { const callback = pending; pending = undefined; callback?.(0); };
  const height = () => document.documentElement.style.getPropertyValue('--app-height');
  const top = () => document.documentElement.style.getPropertyValue('--visual-viewport-top');

  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 812, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 812);
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { pending = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { pending = undefined; }));
  });
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('fits a keyboard-panned editor and restores after keyboard dismissal', () => {
    dispose = installAppViewport();
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    document.body.append(editor);
    editor.focus();
    viewport.height = 390;
    viewport.offsetTop = 48;
    viewport.dispatchEvent(new Event('resize'));
    flush();
    expect(height()).toBe('390px');
    expect(top()).toBe('48px');
    editor.blur();
    viewport.height = 812;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    flush();
    expect(height()).toBe('812px');
    expect(top()).toBe('0px');
  });

  it('never reflows the app to cancel the user\'s pinch zoom', () => {
    dispose = installAppViewport();
    viewport.scale = 2;
    viewport.height = 406;
    viewport.offsetTop = 180;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    flush();
    expect(height()).toBe('812px');
    expect(top()).toBe('0px');
    viewport.scale = 1;
    viewport.height = 700;
    viewport.dispatchEvent(new Event('resize'));
    flush();
    expect(height()).toBe('700px');
  });

  it('updates after rotation and page restoration without applying normal scroll offset', () => {
    dispose = installAppViewport();
    viewport.height = 375;
    viewport.offsetTop = 20;
    window.dispatchEvent(new Event('orientationchange'));
    flush();
    expect(height()).toBe('375px');
    expect(top()).toBe('0px');
    viewport.height = 812;
    window.dispatchEvent(new Event('pageshow'));
    flush();
    expect(height()).toBe('812px');
  });

  it('falls back to window height when visualViewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    dispose = installAppViewport();
    expect(height()).toBe('812px');
    vi.stubGlobal('innerHeight', 450);
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(height()).toBe('450px');
  });

  it('coalesces resize events and removes subscriptions on disposal', () => {
    dispose = installAppViewport();
    viewport.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    dispose();
    dispose = undefined;
    expect(window.cancelAnimationFrame).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('pageshow'));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(height()).toBe('');
  });

  it('ignores transient zero heights while the browser is restoring a page', () => {
    dispose = installAppViewport();
    viewport.height = 0;
    viewport.dispatchEvent(new Event('resize'));
    flush();
    expect(height()).toBe('812px');
  });
});
