/**
 * Ported from twikit/x_client_transaction/transaction.py
 *
 * Derived from https://github.com/iSarabjitDhiman/TweeterPy — with thanks to
 * the original author.
 */

import { createHash } from 'node:crypto';
import type { Element } from 'domhandler';
import { Cubic } from './cubicCurve.js';
import { interpolate } from './interpolate.js';
import { convertRotationToMatrix } from './rotation.js';
import {
  base64Encode,
  floatToHex,
  handleXMigration,
  isOdd,
  pyRound,
  type CheerioRoot,
  type TransactionSession,
} from './utils.js';

const ON_DEMAND_FILE_REGEX = /['|"]{1}ondemand\.s['|"]{1}:\s*['|"]{1}([\w]*)['|"]{1}/m;
const INDICES_REGEX = /(\(\w{1}\[(\d{1,2})\],\s*16\))+/gm;

/**
 * Generates the `x-client-transaction-id` header that x.com's GraphQL endpoints
 * require. The value is derived from a verification key embedded in the home
 * page plus an "animation key" read out of the page's loading animation SVG.
 */
export class ClientTransaction {
  static readonly ADDITIONAL_RANDOM_NUMBER = 3;
  static readonly DEFAULT_KEYWORD = 'obfiowerehiring';

  homePageResponse: CheerioRoot | null = null;
  defaultRowIndex: number | null = null;
  defaultKeyBytesIndices: number[] | null = null;
  key: string | null = null;
  keyBytes: number[] | null = null;
  animationKey: string | null = null;

  async init(session: TransactionSession, headers: Record<string, string>): Promise<void> {
    const homePageResponse = await handleXMigration(session, headers);
    this.homePageResponse = this.validateResponse(homePageResponse);

    const [rowIndex, keyBytesIndices] = await this.getIndices(
      this.homePageResponse,
      session,
      headers
    );
    this.defaultRowIndex = rowIndex;
    this.defaultKeyBytesIndices = keyBytesIndices;

    this.key = this.getKey(this.homePageResponse);
    this.keyBytes = this.getKeyBytes(this.key);
    this.animationKey = this.getAnimationKey(this.keyBytes, this.homePageResponse);
  }

  async getIndices(
    homePageResponse: CheerioRoot | null,
    session: TransactionSession,
    headers: Record<string, string>
  ): Promise<[number, number[]]> {
    const keyByteIndices: string[] = [];
    const response = this.validateResponse(homePageResponse ?? this.homePageResponse);
    const html = response.html();

    const onDemandFile = ON_DEMAND_FILE_REGEX.exec(html);
    if (onDemandFile) {
      const onDemandFileUrl = `https://abs.twimg.com/responsive-web/client-web/ondemand.s.${onDemandFile[1]}a.js`;
      const onDemandFileResponse = await session.request('GET', onDemandFileUrl, { headers });
      for (const match of onDemandFileResponse.text.matchAll(INDICES_REGEX)) {
        keyByteIndices.push(match[2]);
      }
    }

    if (keyByteIndices.length === 0) {
      throw new Error("Couldn't get KEY_BYTE indices");
    }

    const indices = keyByteIndices.map((index) => Number.parseInt(index, 10));
    return [indices[0], indices.slice(1)];
  }

  private validateResponse(response: CheerioRoot | null): CheerioRoot {
    if (response === null || typeof response !== 'function') {
      throw new Error('invalid response');
    }
    return response;
  }

  getKey(response?: CheerioRoot | null): string {
    const page = this.validateResponse(response ?? this.homePageResponse);
    const element = page("[name='twitter-site-verification']").first();
    const content = element.attr('content');
    if (!element.length || content === undefined) {
      throw new Error("Couldn't get key from the page source");
    }
    return content;
  }

  getKeyBytes(key: string): number[] {
    return Array.from(Buffer.from(key, 'base64'));
  }

  getFrames(response?: CheerioRoot | null): Element[] {
    const page = this.validateResponse(response ?? this.homePageResponse);
    return page("[id^='loading-x-anim']").toArray() as Element[];
  }

  get2dArray(keyBytes: number[], response?: CheerioRoot | null, frames?: Element[]): number[][] {
    const page = this.validateResponse(response ?? this.homePageResponse);
    const resolvedFrames = frames && frames.length ? frames : this.getFrames(page);
    const frame = resolvedFrames[keyBytes[5] % 4];
    if (frame === undefined) {
      throw new Error("Couldn't find the loading animation frame");
    }

    // frame -> first element child (the <svg>) -> its second element child, whose
    // "d" path attribute encodes the animation frames.
    const svg = page(frame).children().first();
    const path = svg.children().eq(1);
    const d = path.attr('d');
    if (d === undefined) {
      throw new Error("Couldn't read the animation path from the page source");
    }

    return d
      .slice(9)
      .split('C')
      .map((item) =>
        item
          .replace(/[^\d]+/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((part) => part !== '')
          .map((part) => Number.parseInt(part, 10))
      );
  }

  solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
    const result = (value * (maxVal - minVal)) / 255 + minVal;
    return rounding ? Math.floor(result) : pyRound(result, 2);
  }

  animate(frames: number[], targetTime: number): string {
    const fromColor = [...frames.slice(0, 3), 1].map(Number);
    const toColor = [...frames.slice(3, 6), 1].map(Number);
    const fromRotation = [0.0];
    const toRotation = [this.solve(frames[6], 60.0, 360.0, true)];

    const remaining = frames.slice(7);
    const curves = remaining.map((item, counter) => this.solve(item, isOdd(counter), 1.0, false));

    const cubic = new Cubic(curves);
    const val = cubic.getValue(targetTime);

    const color = interpolate(fromColor, toColor, val).map((value) => (value > 0 ? value : 0));
    const rotation = interpolate(fromRotation, toRotation, val);
    const matrix = convertRotationToMatrix(rotation[0]);

    const strArr = color.slice(0, -1).map((value) => pyRound(value).toString(16));

    for (const value of matrix) {
      let rounded = pyRound(value, 2);
      if (rounded < 0) rounded = -rounded;
      const hexValue = floatToHex(rounded);
      if (hexValue.startsWith('.')) {
        strArr.push(`0${hexValue}`.toLowerCase());
      } else {
        strArr.push(hexValue !== '' ? hexValue : '0');
      }
    }

    strArr.push('0', '0');
    return strArr.join('').replace(/[.-]/g, '');
  }

  getAnimationKey(keyBytes: number[], response?: CheerioRoot | null): string {
    const totalTime = 4096;

    if (this.defaultRowIndex === null || this.defaultKeyBytesIndices === null) {
      throw new Error('ClientTransaction.init() must be called before generating keys');
    }

    const rowIndex = keyBytes[this.defaultRowIndex] % 16;
    const frameTime = this.defaultKeyBytesIndices.reduce(
      (acc, index) => acc * (keyBytes[index] % 16),
      1
    );

    const arr = this.get2dArray(keyBytes, response);
    const frameRow = arr[rowIndex];
    const targetTime = frameTime / totalTime;

    return this.animate(frameRow, targetTime);
  }

  generateTransactionId(
    method: string,
    path: string,
    options: {
      response?: CheerioRoot | null;
      key?: string | null;
      animationKey?: string | null;
      timeNow?: number | null;
    } = {}
  ): string {
    const timeNow =
      options.timeNow ?? Math.floor((Date.now() - 1682924400 * 1000) / 1000);
    const timeNowBytes = [0, 1, 2, 3].map((i) => (timeNow >> (i * 8)) & 0xff);

    const key = options.key ?? this.key ?? this.getKey(options.response);
    const keyBytes = this.getKeyBytes(key);
    const animationKey =
      options.animationKey ?? this.animationKey ?? this.getAnimationKey(keyBytes, options.response);

    const hashInput = `${method}!${path}!${timeNow}${ClientTransaction.DEFAULT_KEYWORD}${animationKey}`;
    const hashBytes = Array.from(createHash('sha256').update(hashInput, 'utf-8').digest());

    const randomNum = Math.floor(Math.random() * 256);
    const bytesArr = [
      ...keyBytes,
      ...timeNowBytes,
      ...hashBytes.slice(0, 16),
      ClientTransaction.ADDITIONAL_RANDOM_NUMBER,
    ];

    const out = Uint8Array.from([randomNum, ...bytesArr.map((item) => item ^ randomNum)]);
    return base64Encode(out).replace(/=+$/, '');
  }
}
