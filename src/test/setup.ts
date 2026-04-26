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
// open animation. jsdom 20 doesn't implement any of these — neither
// `Element.prototype.scrollIntoView` nor `HTMLElement.prototype.scrollIntoView`
// is defined (verified via prototype probe). Polyfill on HTMLElement.prototype
// per the standard inheritance chain (Radix calls these on instance methods,
// which resolve through HTMLElement → Element). Stubs only — no behavior
// beyond not crashing.
const htmlElProto = HTMLElement.prototype as unknown as Record<string, unknown>;
htmlElProto.hasPointerCapture = () => false;
htmlElProto.setPointerCapture = () => {};
htmlElProto.releasePointerCapture = () => {};
htmlElProto.scrollIntoView = () => {};

