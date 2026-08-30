/**
 * Owns the `x-client-transaction-id` header lifecycle.
 *
 * The Python library initialises `ClientTransaction` on the first request and
 * lets any failure propagate. That is fragile in practice: the algorithm reads a
 * key-byte index table and a loading-animation SVG out of x.com's logged-out
 * home page, and x.com periodically reshapes that page — when it does, the
 * header cannot be built at all and every single request would throw.
 *
 * So initialisation failures are recorded and the header is simply omitted,
 * with one warning. Requests then proceed exactly as they would for a client
 * that never sends the header, which is strictly better than failing outright.
 * Set `requireTransactionId: true` to opt into the upstream behaviour instead.
 */

import { DOMAIN } from '../constants.js';
import { ClientTransaction } from '../transaction/transaction.js';
import type { HttpSession } from './http.js';

export interface TransactionManagerOptions {
  /** Throw instead of degrading when the header cannot be generated. */
  requireTransactionId?: boolean;
  /** Suppress the one-time warning emitted when the header is unavailable. */
  silent?: boolean;
}

export class TransactionManager {
  readonly transaction = new ClientTransaction();
  private disabled = false;
  private warned = false;

  constructor(private readonly options: TransactionManagerOptions = {}) {}

  /** Whether the header is currently being omitted. */
  get unavailable(): boolean {
    return this.disabled;
  }

  /**
   * Ensures the generator is initialised and adds the header to `headers`.
   * Mutates `headers` in place.
   */
  async apply(
    session: HttpSession,
    method: string,
    url: string,
    headers: Record<string, string>,
    context: { language: string; userAgent: string }
  ): Promise<void> {
    if (this.disabled) return;

    if (!this.transaction.homePageResponse) {
      const cookiesBackup = { ...session.getCookies() };
      const ctHeaders = {
        'Accept-Language': `${context.language},${context.language.split('-')[0]};q=0.9`,
        'Cache-Control': 'no-cache',
        Referer: `https://${DOMAIN}`,
        'User-Agent': context.userAgent,
      };

      try {
        await this.transaction.init(session, ctHeaders);
      } catch (error) {
        this.fail(error);
        return;
      } finally {
        session.setCookies(cookiesBackup, true);
      }
    }

    try {
      headers['X-Client-Transaction-Id'] = this.transaction.generateTransactionId(
        method,
        new URL(url).pathname
      );
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.options.requireTransactionId) throw error;

    this.disabled = true;
    if (!this.warned && !this.options.silent) {
      this.warned = true;
      console.warn(
        `twitter-free-api: could not generate the x-client-transaction-id header ` +
          `(${(error as Error).message}); continuing without it. ` +
          `x.com has likely changed its home page markup. ` +
          `Pass requireTransactionId: true to treat this as fatal.`
      );
    }
  }
}
