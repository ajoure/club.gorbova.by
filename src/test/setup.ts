import "@testing-library/jest-dom";

// Node 25 exposes an incomplete localStorage global when no backing file is
// configured. Install a deterministic in-memory implementation for tests.
const storageData = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return storageData.size; },
  clear: () => storageData.clear(),
  getItem: (key) => storageData.get(key) ?? null,
  key: (index) => Array.from(storageData.keys())[index] ?? null,
  removeItem: (key) => { storageData.delete(key); },
  setItem: (key, value) => { storageData.set(key, String(value)); },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryStorage,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom does not implement these — stub for Radix/Sheet portal animations.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const globalsWithResizeObserver = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserverStub;
};
globalsWithResizeObserver.ResizeObserver ??= ResizeObserverStub;

if (!Element.prototype.hasPointerCapture) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
