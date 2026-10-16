import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = join(__dirname, '..', '..', 'scripts', 'login-reset.mjs');

describe('login:reset command', () => {
  it('is wired from the api package and the repo root', () => {
    const apiPkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(apiPkg.scripts?.['login:reset']).toBe(
      'node scripts/login-reset.mjs',
    );
    const rootPkg = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '..', 'package.json'),
        'utf8',
      ),
    ) as { scripts?: Record<string, string> };
    expect(rootPkg.scripts?.['login:reset']).toContain('login:reset');
  });

  it('clears lockouts when the loopback API returns 204', async () => {
    const seen: string[] = [];
    const server = await listen((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
      res.writeHead(204);
      res.end();
    });
    try {
      const result = await runReset(server.port);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Login lockouts cleared.');
      expect(seen).toEqual(['POST /auth/login-reset']);
    } finally {
      await closeServer(server.server);
    }
  });

  it('tells the operator to use docker compose exec when the API refuses', async () => {
    const server = await listen((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    try {
      const result = await runReset(server.port);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Could not clear login lockouts.');
      expect(result.stderr).toContain(
        'docker compose exec api npm run login:reset',
      );
    } finally {
      await closeServer(server.server);
    }
  });

  it('fails when nothing is listening', async () => {
    const result = await runReset(1);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The API did not answer');
  });
});

function listen(
  onRequest: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(onRequest);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function runReset(port: number): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, PORT: String(port) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
