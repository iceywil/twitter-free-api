/**
 * HTTP session layer.
 *
 * Stands in for the `httpx.AsyncClient` the Python library uses, and keeps its
 * semantics deliberately: redirects are NOT followed and non-2xx statuses do
 * NOT throw, because `Client.request` maps status codes to exceptions itself
 * and `handleXMigration` depends on seeing the un-followed migration page.
 */

import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import axios, { type AxiosInstance, type AxiosRequestConfig, type Method } from 'axios';
import { createCookieAgent } from 'http-cookie-agent/http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CookieJar } from 'tough-cookie';

const CookieHttpAgent = createCookieAgent(HttpAgent);
const CookieHttpsAgent = createCookieAgent(HttpsAgent);
const CookieHttpsProxyAgent = createCookieAgent(HttpsProxyAgent);
const CookieSocksProxyAgent = createCookieAgent(SocksProxyAgent);

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Query string parameters. Objects and arrays are JSON-encoded, as httpx does. */
  params?: Record<string, unknown>;
  /** JSON request body. */
  json?: unknown;
  /** `application/x-www-form-urlencoded` body, or a pre-encoded string. */
  data?: Record<string, unknown> | string;
  /** `multipart/form-data` body. */
  form?: FormLike;
  /** Raw body, used for binary media uploads. */
  body?: Buffer | Uint8Array;
  responseType?: 'json' | 'text' | 'arraybuffer' | 'stream';
  timeout?: number;
  signal?: AbortSignal;
}

export interface FormLike {
  getHeaders(): Record<string, string>;
  getBuffer?(): Buffer;
  pipe?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed body when JSON, otherwise the raw text/buffer/stream. */
  data: T;
  /** Body decoded as text. Empty for stream responses. */
  text: string;
}

export interface HttpSessionOptions {
  proxy?: string | null;
  timeout?: number;
  headers?: Record<string, string>;
}

export class HttpSession {
  readonly cookieJar: CookieJar;
  private axiosInstance: AxiosInstance;
  private proxyUrl: string | null = null;
  private readonly defaultTimeout: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpSessionOptions = {}) {
    this.cookieJar = new CookieJar();
    this.defaultTimeout = options.timeout ?? 60_000;
    this.defaultHeaders = options.headers ?? {};
    this.axiosInstance = this.buildInstance(options.proxy ?? null);
  }

  private buildInstance(proxy: string | null): AxiosInstance {
    this.proxyUrl = proxy;
    const jarOptions = { cookies: { jar: this.cookieJar } };

    let httpAgent: HttpAgent;
    let httpsAgent: HttpsAgent;

    if (proxy === null) {
      httpAgent = new CookieHttpAgent({ keepAlive: true, ...jarOptions });
      httpsAgent = new CookieHttpsAgent({ keepAlive: true, ...jarOptions });
    } else if (proxy.startsWith('socks')) {
      httpAgent = new CookieSocksProxyAgent(proxy, jarOptions);
      httpsAgent = new CookieSocksProxyAgent(proxy, jarOptions);
    } else {
      httpAgent = new CookieHttpsProxyAgent(proxy, jarOptions);
      httpsAgent = new CookieHttpsProxyAgent(proxy, jarOptions);
    }

    return axios.create({
      httpAgent,
      httpsAgent,
      // The proxy is handled by the agents above; axios' own proxy support
      // would double-apply it.
      proxy: false,
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: this.defaultTimeout,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: this.defaultHeaders,
      transformResponse: [(value: unknown) => value],
    });
  }

  get proxy(): string | null {
    return this.proxyUrl;
  }

  set proxy(url: string | null) {
    this.axiosInstance = this.buildInstance(url);
  }

  async request<T = unknown>(
    method: string,
    url: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };
    const config: AxiosRequestConfig = {
      method: method.toUpperCase() as Method,
      url,
      headers,
      responseType: options.responseType === 'json' ? 'text' : options.responseType ?? 'text',
      timeout: options.timeout ?? this.defaultTimeout,
      signal: options.signal,
    };

    if (options.params !== undefined) {
      config.params = flattenParams(options.params);
    }

    if (options.json !== undefined) {
      config.data = JSON.stringify(options.json);
      headers['content-type'] ??= 'application/json';
    } else if (options.data !== undefined) {
      const encoded =
        typeof options.data === 'string' ? options.data : encodeForm(options.data);
      // httpx sends `data={}` as a bodyless request and leaves the content type
      // alone; mirroring that matters because some endpoints reject an empty
      // JSON body outright.
      if (encoded !== '') {
        config.data = encoded;
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
    } else if (options.form !== undefined) {
      config.data = options.form;
      Object.assign(headers, options.form.getHeaders());
    } else if (options.body !== undefined) {
      config.data = options.body;
    }

    const response = await this.axiosInstance.request(config);
    const responseHeaders = response.headers as unknown as Record<
      string,
      string | string[] | undefined
    >;

    let text = '';
    let data: unknown = response.data;

    if (options.responseType === 'stream') {
      // Leave the stream untouched for the caller to consume.
    } else if (options.responseType === 'arraybuffer') {
      const buffer = Buffer.from(response.data as ArrayBuffer);
      data = buffer;
      text = buffer.toString('utf-8');
    } else {
      text = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      data = text;
      if (options.responseType !== 'text') {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    }

    return {
      status: response.status,
      headers: responseHeaders,
      data: data as T,
      text,
    };
  }

  get<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, options);
  }

  post<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, options);
  }

  // -- cookies ---------------------------------------------------------------

  /** All cookies in the jar as a flat `name -> value` map. */
  getCookies(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const cookie of this.allCookies()) {
      result[cookie.key] = cookie.value;
    }
    return result;
  }

  getCookie(name: string): string | undefined {
    for (const cookie of this.allCookies()) {
      if (cookie.key === name) return cookie.value;
    }
    return undefined;
  }

  setCookies(cookies: Record<string, string>, clearCookies = false): void {
    if (clearCookies) this.clearCookies();
    for (const [name, value] of Object.entries(cookies)) {
      this.cookieJar.setCookieSync(
        `${name}=${value}; Domain=.x.com; Path=/`,
        'https://x.com',
        { ignoreError: true }
      );
      this.cookieJar.setCookieSync(
        `${name}=${value}; Domain=.twitter.com; Path=/`,
        'https://twitter.com',
        { ignoreError: true }
      );
    }
  }

  clearCookies(): void {
    // MemoryCookieStore exposes removeAllCookies synchronously via its callback.
    this.cookieJar.removeAllCookiesSync();
  }

  /**
   * Drops all but the first `ct0` cookie. x.com sets `ct0` for both `.x.com`
   * and `.twitter.com`, and sending both breaks CSRF validation.
   */
  removeDuplicateCt0Cookie(): void {
    const seen = new Set<string>();
    const duplicates: { domain: string; path: string; key: string }[] = [];

    for (const cookie of this.allCookies()) {
      if (cookie.key !== 'ct0') continue;
      if (seen.has('ct0')) {
        duplicates.push({
          domain: cookie.domain ?? '',
          path: cookie.path ?? '/',
          key: cookie.key,
        });
      } else {
        seen.add('ct0');
      }
    }

    const store = this.cookieJar.store as unknown as {
      removeCookie(domain: string, path: string, key: string, cb: (err?: Error) => void): void;
    };
    for (const duplicate of duplicates) {
      store.removeCookie(duplicate.domain, duplicate.path, duplicate.key, () => {});
    }
  }

  private allCookies(): { key: string; value: string; domain?: string | null; path?: string | null }[] {
    const store = this.cookieJar.store as unknown as {
      getAllCookies(
        cb: (
          err: Error | null,
          cookies: { key: string; value: string; domain?: string | null; path?: string | null }[]
        ) => void
      ): void;
    };
    let collected: { key: string; value: string; domain?: string | null; path?: string | null }[] = [];
    store.getAllCookies((_err, cookies) => {
      collected = cookies ?? [];
    });
    return collected;
  }

  async saveCookies(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.getCookies(), null, 2), 'utf-8');
  }

  async loadCookies(path: string): Promise<void> {
    const raw = await readFile(path, 'utf-8');
    this.setCookies(JSON.parse(raw) as Record<string, string>, true);
  }
}

/** httpx JSON-encodes list/dict query values; GraphQL endpoints rely on this. */
export function flattenParams(params: Record<string, unknown>): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      flattened[key] = JSON.stringify(value);
    } else {
      flattened[key] = String(value);
    }
  }
  return flattened;
}

function encodeForm(data: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    search.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return search.toString();
}
