import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): Partial<MediaQueryList> => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom 20 doesn't provide ResizeObserver, but Radix UI primitives
// (Checkbox, Tabs, Select, …) read it during their layout effects. Without
// this stub, mounting any of those crashes the test render. Same role as
// the matchMedia stub above — purely a test-environment polyfill.
class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) { void _callback; }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// Radix Select uses pointer-capture APIs and scrollIntoView during its
// open animation. jsdom doesn't implement these on Element; without stubs
// the option list never renders in tests. Stubs only — no behavior beyond
// not crashing.
const elProto = Element.prototype as unknown as Record<string, unknown>;
if (!elProto.hasPointerCapture) elProto.hasPointerCapture = () => false;
if (!elProto.setPointerCapture) elProto.setPointerCapture = () => {};
if (!elProto.releasePointerCapture) elProto.releasePointerCapture = () => {};
if (!elProto.scrollIntoView) elProto.scrollIntoView = () => {};
