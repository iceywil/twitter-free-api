/** Execute the Castle SDK in Node to mint a genuine $castle_token. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

process.on('uncaughtException', (e: any) => {
  console.log('\nUNCAUGHT inside SDK:', e?.message ?? String(e));
  console.log('  name:', e?.name, '| type:', typeof e);
  if (e?.stack) console.log('  first frame:', String(e.stack).split('\n')[1]?.trim());
  process.exit(3);
});

const sdk = readFileSync('scripts/.castle.js', 'utf-8');
const PK = process.env.CASTLE_PK || 'e8bl5yQW';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const makeElement = (tag: string): any => {
  const attrs: any = [];
  attrs.getNamedItem = () => null;
  attrs.item = () => null;
  const el: any = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    id: '',
    className: '',
    style: {},
    // Automation probes read documentElement.attributes looking for markers
    // such as "selenium"; an empty NamedNodeMap-like object is the honest answer.
    attributes: attrs,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false, length: 0 },
    innerHTML: '', outerHTML: '', textContent: '', innerText: '',
    parentNode: null, parentElement: null, ownerDocument: null,
    children: [], childNodes: [], firstChild: null, lastChild: null,
    firstElementChild: null, lastElementChild: null,
    nextSibling: null, previousSibling: null,
    clientWidth: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0,
    scrollWidth: 0, scrollHeight: 0, offsetTop: 0, offsetLeft: 0,
    setAttribute() {}, removeAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    hasAttributes: () => false,
    getAttributeNames: () => [],
    appendChild: (c: any) => c, removeChild: (c: any) => c, remove() {},
    insertBefore: (c: any) => c, replaceChild: (c: any) => c,
    cloneNode: () => makeElement(tag),
    contains: () => false, matches: () => false, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    getContext: () => null,
    toDataURL: () => '',
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    width: 0, height: 0,
  };
  return el;
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
  createElement: makeElement,
  createElementNS: (_ns: string, tag: string) => makeElement(tag),
  documentElement: makeElement('html'),
  body: makeElement('body'),
  head: makeElement('head'),
  cookie: '',
  referrer: '',
  title: 'X',
  readyState: 'complete',
  visibilityState: 'visible',
  hidden: false,
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  getElementsByTagName: () => [], getElementById: () => null,
  getElementsByClassName: () => [],
  createEvent: () => ({ initEvent() {}, initCustomEvent() {} }),
  createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
  createDocumentFragment: () => makeElement('fragment'),
  hasFocus: () => true,
  elementFromPoint: () => null,
  prerendering: false,
  mozFullScreen: false,
  webkitHidden: false,
  fonts: { check: () => true, ready: Promise.resolve(), values: () => [][Symbol.iterator]() },
  dispatchEvent: () => true,
  defaultView: null,
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
    userAgent: UA, language: 'en-US', languages: ['en-US', 'en'], platform: 'MacIntel',
    hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.', product: 'Gecko',
    productSub: '20030107', cookieEnabled: true, onLine: true, doNotTrack: null,
    plugins: { length: 0, item: () => null, namedItem: () => null, refresh() {} },
    mimeTypes: { length: 0, item: () => null, namedItem: () => null },
    webdriver: false,
    deviceMemory: 8,
    appName: 'Netscape', appCodeName: 'Mozilla',
    appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, addEventListener() {} },
    mediaDevices: { enumerateDevices: async () => [], getSupportedConstraints: () => ({}) },
    serviceWorker: { register: async () => ({}), ready: Promise.resolve({}), controller: null },
    credentials: { get: async () => null, create: async () => null },
    permissions: { query: async () => ({ state: 'prompt', addEventListener() {} }) },
    storage: { estimate: async () => ({ quota: 0, usage: 0 }) },
    getBattery: async () => ({ level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity }),
    standalone: undefined,
    javaEnabled: () => false,
    sendBeacon: () => true,
    userActivation: { hasBeenActive: true, isActive: false },
    pdfViewerEnabled: true,
    scheduling: { isInputPending: () => false },
  },
  screen: {
    width: 1512, height: 982, availWidth: 1512, availHeight: 944,
    availTop: 0, availLeft: 0, colorDepth: 30, pixelDepth: 30,
    orientation: { angle: 0, type: 'landscape-primary', addEventListener() {} },
  },
  location: { href: 'https://x.com/i/flow/login', origin: 'https://x.com', protocol: 'https:', host: 'x.com', hostname: 'x.com', pathname: '/i/flow/login', search: '', hash: '' },
  document: doc,
  localStorage: storage(),
  sessionStorage: storage(),
  indexedDB: undefined,
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
      // Resolve immediately so nothing awaits a network round trip.
      setTimeout(() => {
        this.readyState = 4; this.status = 200;
        this.onreadystatechange?.call(this);
        this.onload?.call(this);
        this.onloadend?.call(this);
        for (const ev of ['load', 'loadend', 'readystatechange']) {
          for (const fn of this.handlers[ev] ?? []) { try { fn.call(this, { type: ev }); } catch {} }
        }
      }, 0);
    }
  },
  fetch: async () => new Response('{}', { status: 200 }),
  addEventListener() {}, removeEventListener() {},
  devicePixelRatio: 2,
  innerWidth: 1512, innerHeight: 862, outerWidth: 1512, outerHeight: 944,
  requestIdleCallback: (fn: any) => setTimeout(() => fn({ timeRemaining: () => 50, didTimeout: false }), 0),
  cancelIdleCallback: () => {},
  requestAnimationFrame: (fn: any) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: () => {},
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  PerformanceObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  ResizeObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  dispatchEvent: () => true,
  matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  Intl,
  external: {},
  chrome: { runtime: {}, loadTimes: () => ({}), csi: () => ({}) },
  Notification: { permission: 'default' },
  speechSynthesis: { getVoices: () => [] },
  webkitRequestFileSystem: () => {},
  openDatabase: () => {},
  history: { length: 2, pushState() {}, replaceState() {} },
  frames: { length: 0 },
  length: 0,
  closed: false,
  origin: 'https://x.com',
  isSecureContext: true,
  caches: undefined,
  Worker: class { postMessage() {} terminate() {} addEventListener() {} },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.top = sandbox;
sandbox.parent = sandbox;

const captured: Record<string, any> = {};
sandbox.webpackChunk_twitter_responsive_web = {
  push(entry: any) {
    Object.assign(captured, entry?.[1] ?? {});
    return 1;
  },
};

const TRACE = process.env.TRACE === '1';
if (TRACE) {
  // Wrap objects recursively so the full access path of the crashing probe is
  // visible, including reads on nested objects.
  const logged = new Set<string>();
  const deep = (target: any, path: string, depth = 0): any => {
    if (target === null || typeof target !== 'object' || depth > 3) return target;
    return new Proxy(target, {
      get(t, k) {
        if (typeof k !== 'string') return (t as any)[k];
        const v = (t as any)[k];
        const key = `${path}.${k}`;
        if (v === undefined && !logged.has(key)) {
          logged.add(key);
          console.log('  [undef]', key);
        }
        if (v !== null && typeof v === 'object' && depth < 3) return deep(v, key, depth + 1);
        return v;
      },
    });
  };
  for (const name of ['document', 'navigator', 'screen', 'external', 'chrome', 'location', 'history', 'performance']) {
    if (sandbox[name] && typeof sandbox[name] === 'object') sandbox[name] = deep(sandbox[name], name);
  }
}

const ctx = createContext(sandbox);
try {
  runInContext(sdk, ctx, { timeout: 30_000 });
} catch (e) {
  console.log('SDK load threw:', (e as Error).message.slice(0, 200));
}

console.log('captured module ids:', Object.keys(captured).join(', ') || '(none)');
const factory = captured['855881'];
if (typeof factory !== 'function') { console.log('module 855881 not captured'); process.exit(1); }

const moduleObj: any = { exports: {} };
try {
  factory(moduleObj, moduleObj.exports);
} catch (e) {
  console.log('factory threw:', (e as Error).message.slice(0, 200));
}
const api: any = moduleObj.exports && Object.keys(moduleObj.exports).length ? moduleObj.exports : moduleObj;
console.log('module exports:', Object.keys(api).join(', ') || '(empty)');

if (typeof api.configure !== 'function') { console.log('no configure() export'); process.exit(1); }

const client = await api.configure({ pk: PK });
console.log('configure() ->', client ? Object.keys(client).join(', ') : client);

const token = await Promise.race([
  client.createRequestToken(),
  new Promise((_, rej) => setTimeout(() => rej(new Error('createRequestToken did not settle within 20s')), 20_000)),
]) as string;

console.log(`\nTOKEN minted: ${token.length} chars`);
console.log('prefix:', token.slice(0, 40));
console.log('has pipe separator:', token.includes('|'), '| pk prefix matches:', token.startsWith(PK + '|'));
writeFileSync('scripts/.minted-token.txt', token);
console.log('saved -> scripts/.minted-token.txt');
