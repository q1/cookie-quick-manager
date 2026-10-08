import { browser } from 'wxt/browser';
import { registerBackground, type BrowserApi } from '../src/lib/gateway';

export default defineBackground(() => {
  registerBackground(browser as unknown as BrowserApi);
});
