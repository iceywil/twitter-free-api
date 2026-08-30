/**
 * Mints an `x-castle-token` (`$castle_token`) natively, no browser.
 *
 * x.com's login endpoints require a token from the Castle.io device-signals
 * SDK. The SDK is configured with a *publishable* key (`pk_…`, Stripe-style),
 * so nothing secret signs the token — it is produced entirely by public
 * client JS. This fetches that JS (`ondemand.castle`) and runs it under
 * `node:vm` inside a locked-down sandbox to obtain a genuine token.
 *
 * A token minted this way was verified accepted by x.com's `begin_login`: the
 * request passed Castle's device check and advanced to username validation.
 *
 * Security note: this executes x.com's own SDK code in a `node:vm` context
 * whose global has no `require`, `process`, `fs`, or network beyond a
 * self-resolving XHR stub. The SDK's only exports are `configure` and
 * `createRequestToken`.
 */

import { createContext, runInContext } from 'node:vm';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** Module id of the Castle SDK entry inside the `ondemand.castle` chunk. */
const CASTLE_MODULE_ID = '855881';

export interface CastleSolverOptions {
  /** User-Agent presented to the SDK's fake `navigator`. */
  userAgent?: string;
  /** Timezone for the fake environment. */
  timezone?: string;
}

export class CastleSolver {
  private client: unknown = null;
  private configured: Promise<void> | null = null;

  constructor(
    private readonly sdkSource: string,
    private readonly pk: string,
    private readonly options: CastleSolverOptions = {}
  ) {}

  /** Loads and configures the SDK once, then reuses the client. */
  private async ensureConfigured(): Promise<void> {
    if (this.configured) return this.configured;
    this.configured = (async () => {
      const captured: Record<string, any> = {};
      const sandbox = buildSandbox(this.options.userAgent ?? DEFAULT_UA);
      sandbox.webpackChunk_twitter_responsive_web = {
        push(entry: any) {
          Object.assign(captured, entry?.[1] ?? {});
          return 1;
        },
      };

      const ctx = createContext(sandbox);
      runInContext(this.sdkSource, ctx, { timeout: 30_000 });

      const factory = captured[CASTLE_MODULE_ID];
      if (typeof factory !== 'function') {
        throw new Error('Castle SDK module was not found in the fetched chunk.');
      }
      const moduleObj: any = { exports: {} };
      factory(moduleObj, moduleObj.exports);
      const api: any = Object.keys(moduleObj.exports).length ? moduleObj.exports : moduleObj;
      if (typeof api.configure !== 'function') {
        throw new Error('Castle SDK has no configure() export.');
      }
      this.client = await api.configure({ pk: this.pk });
    })();
    return this.configured;
  }

  /** Produces a fresh `$castle_token`. */
  async createRequestToken(): Promise<string> {
    await this.ensureConfigured();
    const client = this.client as { createRequestToken(): Promise<string> };
    return Promise.race([
      client.createRequestToken(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Castle createRequestToken timed out')), 20_000)
      ),
    ]);
  }
}

/**
 * Builds the minimal browser-like global the Castle SDK needs, including the
 * DOM/navigator/screen surface its anti-automation probes read (e.g.
 * `documentElement.attributes` — the probe that looks for a `selenium` marker).
 */
function buildSandbox(ua: string): any {
  const makeElement = (tag: string): any => {
    const attributes: any = [];
    attributes.getNamedItem = () => null;
    attributes.item = () => null;
    return {
      tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), nodeType: 1, id: '', className: '',
      style: {}, attributes, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false, length: 0 },
      innerHTML: '', outerHTML: '', textContent: '', innerText: '',
      parentNode: null, parentElement: null, ownerDocument: null,
      children: [], childNodes: [], firstChild: null, lastChild: null,
      firstElementChild: null, lastElementChild: null, nextSibling: null, previousSibling: null,
      clientWidth: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0,
      scrollWidth: 0, scrollHeight: 0, offsetTop: 0, offsetLeft: 0,
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      hasAttribute: () => false, hasAttributes: () => false, getAttributeNames: () => [],
      appendChild: (c: any) => c, removeChild: (c: any) => c, remove() {},
      insertBefore: (c: any) => c, replaceChild: (c: any) => c, cloneNode: () => makeElement(tag),
      contains: () => false, matches: () => false, closest: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      getContext: () => null, toDataURL: () => '',
      getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      focus() {}, blur() {}, click() {}, scrollIntoView() {}, width: 0, height: 0,
    };
  };

  const storage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
  };

  const doc: any = {
    createElement: makeElement, createElementNS: (_ns: string, t: string) => makeElement(t),
    documentElement: makeElement('html'), body: makeElement('body'), head: makeElement('head'),
    cookie: '', referrer: '', title: 'X', readyState: 'complete', visibilityState: 'visible', hidden: false,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getElementsByTagName: () => [], getElementById: () => null, getElementsByClassName: () => [],
    createEvent: () => ({ initEvent() {}, initCustomEvent() {} }),
    createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
    createDocumentFragment: () => makeElement('fragment'),
    hasFocus: () => true, elementFromPoint: () => null, prerendering: false, mozFullScreen: false, webkitHidden: false,
    fonts: { check: () => true, ready: Promise.resolve(), values: () => [][Symbol.iterator]() },
    dispatchEvent: () => true, defaultView: null,
  };

  const sandbox: any = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Error, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set,
    WeakMap, WeakSet, Symbol, Proxy, Reflect, Function, TypeError, RangeError,
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int32Array, Float32Array, Float64Array,
    ArrayBuffer, DataView, Blob, Response, Request, Headers,
    TextEncoder, TextDecoder, URL, URLSearchParams,
    CompressionStream: (globalThis as any).CompressionStream,
    DecompressionStream: (globalThis as any).DecompressionStream,
    btoa, atob, crypto,
    performance: { now: () => Date.now(), timeOrigin: Date.now(), getEntriesByType: () => [] },
    navigator: {
      userAgent: ua, language: 'en-US', languages: ['en-US', 'en'], platform: 'MacIntel',
      hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.', product: 'Gecko',
      productSub: '20030107', cookieEnabled: true, onLine: true, doNotTrack: null,
      plugins: { length: 0, item: () => null, namedItem: () => null, refresh() {} },
      mimeTypes: { length: 0, item: () => null, namedItem: () => null },
      webdriver: false, deviceMemory: 8, appName: 'Netscape', appCodeName: 'Mozilla',
      appVersion: ua.replace('Mozilla/', ''),
      connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, addEventListener() {} },
      mediaDevices: { enumerateDevices: async () => [], getSupportedConstraints: () => ({}) },
      serviceWorker: { register: async () => ({}), ready: Promise.resolve({}), controller: null },
      credentials: { get: async () => null, create: async () => null },
      permissions: { query: async () => ({ state: 'prompt', addEventListener() {} }) },
      storage: { estimate: async () => ({ quota: 0, usage: 0 }) },
      getBattery: async () => ({ level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity }),
      standalone: undefined, javaEnabled: () => false, sendBeacon: () => true,
      userActivation: { hasBeenActive: true, isActive: false }, pdfViewerEnabled: true,
      scheduling: { isInputPending: () => false },
    },
    screen: {
      width: 1512, height: 982, availWidth: 1512, availHeight: 944, availTop: 0, availLeft: 0,
      colorDepth: 30, pixelDepth: 30, orientation: { angle: 0, type: 'landscape-primary', addEventListener() {} },
    },
    location: {
      href: 'https://x.com/i/flow/login', origin: 'https://x.com', protocol: 'https:',
      host: 'x.com', hostname: 'x.com', pathname: '/i/flow/login', search: '', hash: '',
    },
    document: doc, localStorage: storage(), sessionStorage: storage(), indexedDB: undefined,
    XMLHttpRequest: class {
      readyState = 0; status = 0; responseText = '{}'; response = '{}';
      onload: any = null; onreadystatechange: any = null; onerror: any = null; onloadend: any = null;
      private handlers: Record<string, any[]> = {};
      open() { this.readyState = 1; }
      setRequestHeader() {}
      getAllResponseHeaders() { return ''; }
      abort() {}
      addEventListener(ev: string, fn: any) { (this.handlers[ev] ||= []).push(fn); }
      removeEventListener() {}
      send() {
        setTimeout(() => {
          this.readyState = 4; this.status = 200;
          this.onreadystatechange?.call(this); this.onload?.call(this); this.onloadend?.call(this);
          for (const ev of ['load', 'loadend', 'readystatechange'])
            for (const fn of this.handlers[ev] ?? []) { try { fn.call(this, { type: ev }); } catch { /* ignore */ } }
        }, 0);
      }
    },
    fetch: async () => new Response('{}', { status: 200 }),
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 2,
    innerWidth: 1512, innerHeight: 862, outerWidth: 1512, outerHeight: 944,
    requestIdleCallback: (fn: any) => setTimeout(() => fn({ timeRemaining: () => 50, didTimeout: false }), 0),
    cancelIdleCallback: () => {}, requestAnimationFrame: (fn: any) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: () => {},
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    PerformanceObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    Intl, external: {}, chrome: { runtime: {}, loadTimes: () => ({}), csi: () => ({}) },
    Notification: { permission: 'default' }, speechSynthesis: { getVoices: () => [] },
    webkitRequestFileSystem: () => {}, openDatabase: () => {},
    history: { length: 2, pushState() {}, replaceState() {} }, frames: { length: 0 },
    length: 0, closed: false, origin: 'https://x.com', isSecureContext: true, caches: undefined,
    Worker: class { postMessage() {} terminate() {} addEventListener() {} },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  return sandbox;
}
