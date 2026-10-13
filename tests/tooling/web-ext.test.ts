import { describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:net';
// This regression exercises the installed, lockfile-patched development tool.
import { connectToFirefox } from '../../node_modules/web-ext/lib/firefox/rdp-client.js';

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port.');
  return address.port;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function packet(value: unknown) {
  const json = JSON.stringify(value);
  return `${Buffer.byteLength(json)}:${json}`;
}

describe('web-ext Bun startup compatibility', () => {
  it('rejects a refused connection so Firefox startup can retry instead of crashing', async () => {
    const server = createServer();
    const port = await listen(server);
    await close(server);
    await expect(connectToFirefox(port)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('completes the root handshake and still sends subsequent RDP requests', async () => {
    const server = createServer((socket) => {
      socket.write(packet({ from: 'root', applicationType: 'browser', traits: {} }));
      socket.once('data', () => socket.write(packet({ from: 'root', addonsActor: 'test-addon' })));
    });
    const port = await listen(server);
    const client = await connectToFirefox(port);
    try {
      expect(await client.request('getRoot')).toMatchObject({ addonsActor: 'test-addon' });
    } finally {
      client.disconnect();
      await close(server);
    }
  });
});
