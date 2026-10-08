import { cookieKey, type CookieRecord } from '@cookie-loom/core';
import { createGateway, type BrowserApi } from '../../apps/extension/src/lib/gateway';
import { withRemoteMutations } from '../../apps/extension/src/lib/mutation-coordinator';

declare const browser: BrowserApi & {
  runtime: BrowserApi['runtime'] & { sendMessage(message: unknown): Promise<unknown> };
};

const run = new URLSearchParams(location.search).get('nativeRun');
const resultKey = 'cookieLoomNativeCoordinatorResult';
const gateway = withRemoteMutations(createGateway(browser), (message) =>
  browser.runtime.sendMessage(message),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void (async () => {
  const before = await gateway.getPreferences();
  const seed = (name: string): CookieRecord => ({
    name,
    value: 'synthetic-coordinator-value',
    domain: 'coordinator.localhost',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: true,
    session: true,
    sameSite: 'lax',
    storeId: 'firefox-default',
  });
  const [first, second] = await Promise.all([
    gateway.saveCookie(seed('loom_remote_first')),
    gateway.saveCookie(seed('loom_remote_second')),
  ]);
  const nextTheme = before.theme === 'dark' ? 'light' : 'dark';
  await Promise.all([
    gateway.setProtection([first], true),
    gateway.setProtection([second], true),
    gateway.updatePreferences({ theme: nextTheme }),
  ]);
  const saved = await gateway.getPreferences();
  assert(saved.theme === nextTheme, 'Concurrent protection updates lost the theme change.');
  assert(
    [cookieKey(first), cookieKey(second), ...before.protectedKeys].every((key) =>
      saved.protectedKeys.includes(key),
    ),
    'Concurrent page messages lost a protected identity.',
  );
  const retained = await gateway.deleteCookies([first, second]);
  assert(
    retained.protected.length === 2 && retained.deleted.length === 0,
    'The coordinator deleted a newly protected cookie.',
  );
  await gateway.setProtection([first, second], false);
  const removed = await gateway.deleteCookies([first, second]);
  assert(removed.deleted.length === 2 && removed.failed.length === 0, 'Remote cleanup failed.');
  await gateway.updatePreferences({ theme: before.theme });
  await browser.storage.local.set({ [resultKey]: { run, success: true } });
})().catch(async (error) => {
  await browser.storage.local.set({
    [resultKey]: {
      run,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    },
  });
});
