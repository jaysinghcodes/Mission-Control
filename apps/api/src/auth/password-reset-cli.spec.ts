import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = join(__dirname, '..', '..', 'scripts', 'password-reset.mjs');

describe('password:reset command', () => {
  it('is wired from the api package and the repo root', () => {
    const apiPkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(apiPkg.scripts?.['password:reset']).toBe(
      'node scripts/password-reset.mjs',
    );
    const rootPkg = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '..', 'package.json'),
        'utf8',
      ),
    ) as { scripts?: Record<string, string> };
    expect(rootPkg.scripts?.['password:reset']).toContain('password:reset');
  });

  it('prints the new password once when the loopback API returns it', async () => {
    const seen: string[] = [];
    const server = await listen((req, res) => {
      seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ password: 'fresh-pass-1' }));
    });
    try {
      const result = await runReset(server.port);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'Dashboard password, shown once: fresh-pass-1',
      );
      expect(result.stdout.split('fresh-pass-1').length - 1).toBe(1);
      expect(result.stdout).toContain('Every session was revoked.');
      expect(result.stderr).not.toContain('fresh-pass-1');
      expect(seen).toEqual(['POST /auth/password-reset']);
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
      expect(result.stderr).toContain(
        'Could not reset the dashboard password.',
      );
      expect(result.stderr).toContain(
        'docker compose exec api npm run password:reset',
      );
      expect(result.stdout).not.toContain('Dashboard password');
    } finally {
      await closeServer(server.server);
    }
  });

  it('fails when nothing is listening', async () => {
    const result = await runReset(1);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The API did not answer');
    expect(result.stderr).toContain(
      'docker compose exec api npm run password:reset',
    );
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
