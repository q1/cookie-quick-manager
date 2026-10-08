import { browser } from 'wxt/browser';
import { createGateway, type BrowserApi, type GatewayContext } from './gateway';
import { withRemoteMutations } from './mutation-coordinator';

const query = new URLSearchParams(location.search);
const sourceTab = query.get('sourceTab');
const sourceTabId = sourceTab === null ? NaN : Number(sourceTab);
let sourceOrigin: string | undefined;
try {
  const origin = new URL(query.get('sourceOrigin') ?? '');
  if (/^https?:$/.test(origin.protocol)) sourceOrigin = origin.origin;
} catch {
  /* Directly opened pages have no captured source origin. */
}
const context: GatewayContext = {
  ...(Number.isSafeInteger(sourceTabId) && sourceTabId >= 0 ? { sourceTabId } : {}),
  ...(sourceOrigin ? { sourceOrigin } : {}),
  useActiveTab: /\/popup(?:\/index)?\.html$/.test(location.pathname),
};

export const browserGateway = withRemoteMutations(
  createGateway(browser as unknown as BrowserApi, context),
  (message) => browser.runtime.sendMessage(message),
);
