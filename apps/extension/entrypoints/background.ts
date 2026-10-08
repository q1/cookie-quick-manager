import { browser } from 'wxt/browser';
import { createGateway, registerBackground, type BrowserApi } from '../src/lib/gateway';
import { registerMutationCoordinator, type MutationRuntime } from '../src/lib/mutation-coordinator';

export default defineBackground(() => {
  const api = browser as unknown as BrowserApi;
  const gateway = createGateway(api);
  const coordinator = registerMutationCoordinator(
    browser.runtime as unknown as MutationRuntime,
    gateway,
  );
  registerBackground(api, gateway, coordinator.enqueue);
});
