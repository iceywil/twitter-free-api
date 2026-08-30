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

const makeElement = (tag: string): any => ({
  tagName: tag.toUpperCase(),
  style: {},
  setAttribute() {}, getAttribute: () => null, appendChild() {}, removeChild() {}, remove() {},
  addEventListener() {}, removeEventListener() {},
  getContext: () => null,          // no canvas/WebGL in Node
  toDataURL: () => '',
  width: 0, height: 0,
  children: [], childNodes: [],
});

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
    plugins: { length: 0 }, mimeTypes: { length: 0 }, webdriver: false,
    deviceMemory: 8, connection: undefined,
  },
  screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 944, colorDepth: 30, pixelDepth: 30, orientation: { angle: 0, type: 'landscape-primary' } },
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
  const seen = new Set<string>();
  const logUndef = (label: string, target: any) =>
    new Proxy(target, {
      get(t, k) {
        const v = (t as any)[k];
        const key = `${label}.${String(k)}`;
        if (v === undefined && typeof k === 'string' && !seen.has(key)) {
          seen.add(key);
          console.log('  [undefined read]', key);
        }
        return v;
      },
    });
  sandbox.document = logUndef('document', sandbox.document);
  sandbox.navigator = logUndef('navigator', sandbox.navigator);
  sandbox.screen = logUndef('screen', sandbox.screen);
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
