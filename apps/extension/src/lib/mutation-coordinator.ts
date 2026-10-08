import { validateCookie, type CookieRecord } from '@cookie-loom/core';
import { GatewayError } from './gateway';
import type { Gateway, Preferences } from './types';

const CHANNEL = 'cookie-loom:mutation:v1';
type Operation =
  | { kind: 'save'; cookie: CookieRecord; original?: CookieRecord }
  | { kind: 'delete'; cookies: CookieRecord[] }
  | { kind: 'preferences'; patch: Partial<Pick<Preferences, 'theme' | 'cleanOnStartup'>> }
  | { kind: 'protection'; cookies: CookieRecord[]; value: boolean };
type Request = { channel: typeof CHANNEL; operation: Operation };
type Response = { ok: true; value: unknown } | { ok: false; error: string };
type Sender = { id?: string; url?: string };
type Listener = (
  message: unknown,
  sender: Sender,
  sendResponse: (response: Response) => void,
) => true | undefined;
export type Enqueue = <T>(operation: () => Promise<T>) => Promise<T>;

export interface MutationRuntime {
  id: string;
  getURL(path: string): string;
  onMessage: { addListener(listener: Listener): void; removeListener(listener: Listener): void };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function cookie(value: unknown): value is CookieRecord {
  return (
    record(value) &&
    !validateCookie(value, { now: null }).some((issue) => issue.severity === 'error')
  );
}
function cookies(value: unknown): value is CookieRecord[] {
  return Array.isArray(value) && value.every(cookie);
}
function operation(value: unknown): value is Operation {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'save':
      return (
        fields(value, ['kind', 'cookie', 'original']) &&
        cookie(value.cookie) &&
        (value.original === undefined || cookie(value.original))
      );
    case 'delete':
      return fields(value, ['kind', 'cookies']) && cookies(value.cookies);
    case 'protection':
      return (
        fields(value, ['kind', 'cookies', 'value']) &&
        cookies(value.cookies) &&
        typeof value.value === 'boolean'
      );
    case 'preferences': {
      const patch = value.patch;
      return (
        fields(value, ['kind', 'patch']) &&
        record(patch) &&
        fields(patch, ['theme', 'cleanOnStartup']) &&
        (!('theme' in patch) || ['system', 'light', 'dark'].includes(patch.theme as string)) &&
        (!('cleanOnStartup' in patch) || typeof patch.cleanOnStartup === 'boolean')
      );
    }
    default:
      return false;
  }
}

function trustedSender(runtime: MutationRuntime, sender: Sender): boolean {
  if (sender.id !== runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    const extension = new URL(runtime.getURL('/'));
    return (
      url.protocol === extension.protocol &&
      url.host === extension.host &&
      !url.username &&
      !url.password &&
      ['/workbench.html', '/options.html', '/popup.html', '/popup/index.html'].includes(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** One background queue owns every product mutation, including browser startup. */
export function registerMutationCoordinator(runtime: MutationRuntime, gateway: Gateway) {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue: Enqueue = (operation) => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  };
  const listener: Listener = (message, sender, sendResponse) => {
    // Callback responses also support Chrome versions before promise listeners.
    // Unrelated messages must not claim the channel.
    if (!record(message) || message.channel !== CHANNEL) return undefined;
    if (!trustedSender(runtime, sender)) {
      sendResponse({ ok: false, error: 'Untrusted mutation sender.' });
      return true;
    }
    if (!fields(message, ['channel', 'operation']) || !operation(message.operation)) {
      sendResponse({ ok: false, error: 'Invalid mutation request.' });
      return true;
    }
    const action = message.operation;
    void enqueue(async (): Promise<Response> => {
      try {
        let value: unknown;
        switch (action.kind) {
          case 'save':
            value = await gateway.saveCookie(action.cookie, action.original);
            break;
          case 'delete':
            value = await gateway.deleteCookies(action.cookies);
            break;
          case 'preferences':
            value = await gateway.updatePreferences(action.patch);
            break;
          case 'protection':
            value = await gateway.setProtection(action.cookies, action.value);
            break;
        }
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof GatewayError
              ? error.message
              : 'The browser operation failed. Refresh and try again.',
        };
      }
    }).then(sendResponse);
    return true;
  };
  runtime.onMessage.addListener(listener);
  return { enqueue, dispose: () => runtime.onMessage.removeListener(listener) };
}

/** Reads and user-gesture APIs stay local; mutations go to the shared background owner. */
export function withRemoteMutations(
  local: Gateway,
  send: (message: Request) => Promise<unknown>,
): Gateway {
  async function request<T>(operation: Operation): Promise<T> {
    let response: unknown;
    try {
      response = await send({ channel: CHANNEL, operation });
    } catch {
      throw new Error(
        'The background connection was interrupted. Refresh to review changes before trying again.',
      );
    }
    if (!record(response) || typeof response.ok !== 'boolean') {
      throw new Error('The background returned an invalid response. Refresh before trying again.');
    }
    if (!response.ok)
      throw new Error(
        typeof response.error === 'string' ? response.error : 'The browser operation failed.',
      );
    return response.value as T;
  }
  return {
    ...local,
    saveCookie: (cookie, original) =>
      request({ kind: 'save', cookie, ...(original ? { original } : {}) }),
    deleteCookies: (cookies) => request({ kind: 'delete', cookies }),
    updatePreferences: (patch) => request({ kind: 'preferences', patch }),
    setProtection: (cookies, value) => request({ kind: 'protection', cookies, value }),
  };
}
