/**
 * Ported from twikit/ui_metrics/__init__.py
 *
 * The Python version evaluates the obfuscated function with Js2Py. Node runs
 * JavaScript natively, so this uses `node:vm` instead — which also removes the
 * need for upstream's `==` -> `===` rewrite, a workaround for Js2Py comparing
 * objects by value rather than by reference.
 */

import { createContext, runInContext } from 'node:vm';
import { MockDocument } from './dom.js';

const FUNCTION_PATTERN = /function [a-zA-Z]+\(\) (\{.+\})/;

/**
 * Runs the obfuscated `ui_metrics` function x.com serves at
 * `/i/js_inst?c_name=ui_metrics` and returns its result as a JSON string,
 * ready to be posted back during login.
 */
export function solveUiMetrics(uiMetrics: string): string {
  const match = FUNCTION_PATTERN.exec(uiMetrics);
  if (!match) {
    throw new Error('No function pattern found in ui_metrics input');
  }

  const innerFunction = match[1];
  const sandbox: Record<string, unknown> = {
    document: new MockDocument(),
    navigator: { userAgent: '' },
    window: {},
  };
  sandbox.window = sandbox;

  const context = createContext(sandbox);
  runInContext(`function main() ${innerFunction}`, context, { timeout: 10_000 });
  const result = runInContext('main()', context, { timeout: 10_000 });

  return pythonStyleJson(result);
}

/**
 * Serializes like Python's `str()` on the Js2Py result followed by upstream's
 * `'` -> `"` swap: `", "` between items and `": "` after keys.
 */
function pythonStyleJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  if (Array.isArray(value)) {
    return `[${value.map(pythonStyleJson).join(', ')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${JSON.stringify(key)}: ${pythonStyleJson(item)}`
    );
    return `{${entries.join(', ')}}`;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  return JSON.stringify(value);
}
