import { describe, expect, it, vi } from 'vitest';
import { createDemoGateway } from './demo-gateway';
import { registerMutationCoordinator, type MutationRuntime } from './mutation-coordinator';

function fixture() {
  let listener!: Parameters<MutationRuntime['onMessage']['addListener']>[0];
  const gateway = createDemoGateway();
  const dispose = vi.fn();
  const coordinator = registerMutationCoordinator(
    {
      id: 'test',
      getURL: (path) => `moz-extension://test${path}`,
      onMessage: {
        addListener: (value) => {
          listener = value;
        },
        removeListener: dispose,
      },
    },
    gateway,
  );
  const sender = { id: 'test', url: 'moz-extension://test/workbench.html' };
  const request = {
    channel: 'cookie-loom:mutation:v1',
    operation: { kind: 'preferences', patch: { theme: 'dark' } },
  };
  return {
    gateway,
    coordinator,
    dispose,
    request,
    sender,
    dispatch: (message: unknown, source: typeof sender, response: Parameters<typeof listener>[2]) =>
      listener(message, source, response),
    invoke: (message: unknown = request, source = sender) => {
      let respond!: Parameters<typeof listener>[2];
      const response = new Promise((resolve) => {
        respond = resolve;
      });
      return listener(message, source, respond) === true ? response : undefined;
    },
  };
}

describe('mutation message boundary', () => {
  it.each(['/workbench.html', '/options.html', '/popup.html', '/popup/index.html'])(
    'accepts own extension page %s',
    async (path) => {
      const f = fixture();
      expect(
        await f.invoke(f.request, { id: 'test', url: `moz-extension://test${path}?sourceTab=1` }),
      ).toMatchObject({ ok: true });
    },
  );

  it.each([
    { id: 'other', url: 'moz-extension://test/workbench.html' },
    { id: 'test', url: 'https://website.example/workbench.html' },
    { id: 'test', url: 'moz-extension://other/workbench.html' },
    { id: 'test', url: 'moz-extension://test/unknown.html' },
    { id: 'test', url: '' },
  ])('rejects an untrusted sender %o', async (sender) => {
    const f = fixture();
    expect(await f.invoke(f.request, sender)).toMatchObject({
      ok: false,
      error: 'Untrusted mutation sender.',
    });
    expect((await f.gateway.getPreferences()).theme).toBe('system');
  });

  it('does not claim unrelated messages', () => {
    const f = fixture();
    const respond = vi.fn();
    expect(f.dispatch({ channel: 'other' }, f.sender, respond)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
  });

  it.each(['valid', 'invalid', 'untrusted'] as const)(
    'keeps a callback-only runtime channel open for %s requests without returning a promise',
    async (kind) => {
      const f = fixture();
      const respond = vi.fn();
      const message =
        kind === 'invalid'
          ? { channel: f.request.channel, operation: { kind: 'unknown' } }
          : f.request;
      const sender = kind === 'untrusted' ? { id: 'test', url: 'https://site.example/' } : f.sender;
      const handled = f.dispatch(message, sender, respond);
      expect(handled).toBe(true);
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(respond.mock.calls[0]![0]).toMatchObject({ ok: kind === 'valid' });
    },
  );

  it.each([
    { kind: 'cookies.set', details: {} },
    { kind: 'preferences', patch: { protectedKeys: ['forged'] } },
    { kind: 'preferences', patch: { theme: 'invalid' } },
    { kind: 'protection', cookies: [], value: 'true' },
    { kind: 'delete', cookies: [{}] },
    { kind: 'save', cookie: null },
  ])('rejects unknown or malformed operations %o', async (operation) => {
    const f = fixture();
    expect(await f.invoke({ channel: f.request.channel, operation })).toMatchObject({
      ok: false,
      error: 'Invalid mutation request.',
    });
  });

  it('does not expose arbitrary browser errors in mutation responses', async () => {
    const f = fixture();
    vi.spyOn(f.gateway, 'updatePreferences').mockRejectedValue(new Error('synthetic-cookie-value'));
    expect(await f.invoke()).toEqual({
      ok: false,
      error: 'The browser operation failed. Refresh and try again.',
    });
  });

  it('removes the runtime listener on disposal', () => {
    const f = fixture();
    f.coordinator.dispose();
    expect(f.dispose).toHaveBeenCalledOnce();
  });
});
