/** Ported from twikit/_captcha/base.py */

import * as cheerio from 'cheerio';
import { DOMAIN } from '../constants.js';
import type { Client } from '../client/client.js';
import type { HttpResponse } from '../internal/http.js';

export interface UnlockHTML {
  authenticityToken: string | null;
  assignmentToken: string | null;
  needsUnlock: boolean;
  startButton: boolean;
  finishButton: boolean;
  deleteButton: boolean;
  blob: string | null;
}

export abstract class CaptchaSolver {
  static readonly CAPTCHA_URL = `https://${DOMAIN}/account/access`;
  static readonly CAPTCHA_SITE_KEY = '0152B4EB-D2DC-460A-89A1-629838B529C9';

  /** Assigned by the `Client` constructor when the solver is passed in. */
  client!: Client;
  abstract maxAttempts: number;

  abstract solveFuncaptcha(blob: string | null): Promise<{
    status?: string;
    solution?: { token?: string };
    [key: string]: unknown;
  }>;

  get captchaUrl(): string {
    return CaptchaSolver.CAPTCHA_URL;
  }

  async getUnlockHtml(): Promise<[HttpResponse, UnlockHTML]> {
    const headers = {
      'X-Twitter-Client-Language': 'en-US',
      'User-Agent': this.client.userAgent,
      'Upgrade-Insecure-Requests': '1',
    };
    const [, response] = await this.client.get(this.captchaUrl, { headers });
    return [response, parseUnlockHtml(response.text)];
  }

  /** Extracts the `return {...};` payload from the served ui_metrics script. */
  async uiMetrix(): Promise<string> {
    const [js] = await this.client.get<string>(`https://${DOMAIN}/i/js_inst?c_name=ui_metrics`);
    const match = /return (\{[\s\S]*?\});/.exec(String(js));
    if (!match) throw new Error('Could not extract ui_metrics payload');
    return match[1];
  }

  async confirmUnlock(
    authenticityToken: string | null,
    assignmentToken: string | null,
    options: { verificationString?: string | null; uiMetrics?: boolean } = {}
  ): Promise<[HttpResponse, UnlockHTML]> {
    const data: Record<string, string> = {
      authenticity_token: authenticityToken ?? '',
      assignment_token: assignmentToken ?? '',
      lang: 'en',
      flow: '',
    };
    const params: Record<string, string> = {};

    if (options.verificationString) {
      data.verification_string = options.verificationString;
      data.language_code = 'en';
      params.lang = 'en';
    }
    if (options.uiMetrics) {
      data.ui_metrics = await this.uiMetrix();
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Upgrade-Insecure-Requests': '1',
      Referer: this.captchaUrl,
    };

    const [, response] = await this.client.post(this.captchaUrl, { params, data, headers });
    return [response, parseUnlockHtml(response.text)];
  }
}

export function parseUnlockHtml(html: string): UnlockHTML {
  const $ = cheerio.load(html);

  const authenticityToken = $('input[name="authenticity_token"]').attr('value') ?? null;
  const assignmentToken = $('input[name="assignment_token"]').attr('value') ?? null;

  const needsUnlock = $('input#verification_string').length > 0;
  const startButton = $('input[value="Start"]').length > 0;
  const finishButton = $('input[value="Continue to X"]').length > 0;
  const deleteButton = $('input[value="Delete"]').length > 0;

  const iframe = $('#arkose_iframe');
  let blob: string | null = null;
  if (iframe.length) {
    const match = /data=(.+)/.exec(iframe.attr('src') ?? '');
    blob = match ? match[1] : null;
  }

  return {
    authenticityToken,
    assignmentToken,
    needsUnlock,
    startButton,
    finishButton,
    deleteButton,
    blob,
  };
}
