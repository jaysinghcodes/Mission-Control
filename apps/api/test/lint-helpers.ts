import { wireText } from '../src/wire-text';

/**
 * supertest types Response.body as any. Callers name the JSON they assert.
 */
export function responseJson<T>(res: { body: unknown }): T {
  return res.body as T;
}

/** Nest error messages are a string or a list. This matches String(message). */
export function bodyMessage(res: { body: unknown }): string {
  return wireText(responseJson<{ message?: unknown }>(res).message);
}

/**
 * Return a Promise the way an async function would, without an empty await.
 * A sync throw becomes a rejection. A returned value resolves.
 */
export function promiseFn<A extends unknown[], T>(
  fn: (...args: A) => T,
): (...args: A) => Promise<Awaited<T>> {
  return (...args: A) => {
    try {
      return Promise.resolve(fn(...args));
    } catch (err) {
      // An async function rejects with the thrown value, Error or not.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- preserve that thrown value
      return Promise.reject(err);
    }
  };
}
