import http from 'http';

export type VaultServer = {
  url: string;
  stop: () => Promise<void>;
};

export async function startVaultServer({ port = 0, token = 'test-token' }: { port?: number; token?: string }): Promise<VaultServer> {
  let stored: Record<string, string> | null = null;

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 404;
        return res.end('not found');
      }

      if (!req.url.startsWith('/api/vault/secrets')) {
        res.statusCode = 404;
        return res.end('not found');
      }

      const auth = req.headers['authorization'] || '';
      if (!String(auth).startsWith('Bearer ') || String(auth).slice(7) !== token) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString('utf8');
        stored = JSON.parse(body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: true }));
      }

      if (req.method === 'GET') {
        if (!stored) {
          res.statusCode = 404;
          return res.end('not found');
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(stored));
      }

      res.statusCode = 405;
      res.end('method not allowed');
    } catch (e) {
      res.statusCode = 500;
      res.end('server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const portNum = typeof addr === 'string' ? 0 : (addr ? addr.port : 0);
  const url = `http://127.0.0.1:${portNum}`;

  return {
    url,
    stop: async () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}
