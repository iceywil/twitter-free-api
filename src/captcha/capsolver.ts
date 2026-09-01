
import axios from 'axios';
import { CaptchaSolver } from './base.js';

export interface CapsolverOptions {
  /** Capsolver API key, from https://capsolver.com */
  apiKey: string;
  /** Maximum number of attempts to solve the captcha. */
  maxAttempts?: number;
  /** Seconds between task-result polls. */
  getResultInterval?: number;
  useBlobData?: boolean;
}

interface CapsolverTask {
  taskId: string;
  [key: string]: unknown;
}

interface CapsolverResult {
  status?: string;
  solution?: { token?: string };
  [key: string]: unknown;
}

/**
 * Automatically unlocks a locked account by solving the Arkose FunCaptcha.
 *
 * @example
 * const solver = new Capsolver({ apiKey: 'your_api_key', maxAttempts: 10 });
 * const client = new Client({ captchaSolver: solver });
 */
export class Capsolver extends CaptchaSolver {
  readonly apiKey: string;
  maxAttempts: number;
  readonly getResultInterval: number;
  readonly useBlobData: boolean;

  constructor(options: CapsolverOptions) {
    super();
    this.apiKey = options.apiKey;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.getResultInterval = options.getResultInterval ?? 1.0;
    this.useBlobData = options.useBlobData ?? false;
  }

  async createTask(taskData: Record<string, unknown>): Promise<CapsolverTask> {
    const response = await axios.post(
      'https://api.capsolver.com/createTask',
      { clientKey: this.apiKey, task: taskData },
      { headers: { 'content-type': 'application/json' } }
    );
    return response.data as CapsolverTask;
  }

  async getTaskResult(taskId: string): Promise<CapsolverResult> {
    const response = await axios.post(
      'https://api.capsolver.com/getTaskResult',
      { clientKey: this.apiKey, taskId },
      { headers: { 'content-type': 'application/json' } }
    );
    return response.data as CapsolverResult;
  }

  async solveFuncaptcha(blob: string | null): Promise<CapsolverResult> {
    const proxy = this.client.proxy;
    const captchaType = proxy === null ? 'FunCaptchaTaskProxyLess' : 'FunCaptchaTask';

    const taskData: Record<string, unknown> = {
      type: captchaType,
      websiteURL: 'https://iframe.arkoselabs.com',
      websitePublicKey: CaptchaSolver.CAPTCHA_SITE_KEY,
      funcaptchaApiJSSubdomain: 'https://client-api.arkoselabs.com',
      proxy,
    };

    if (this.useBlobData) {
      taskData.data = JSON.stringify({ blob });
      taskData.userAgent = this.client.userAgent;
    }

    const task = await this.createTask(taskData);

    for (;;) {
      await sleep(this.getResultInterval * 1000);
      const result = await this.getTaskResult(task.taskId);
      if (result.status === 'ready' || result.status === 'failed') {
        return result;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
