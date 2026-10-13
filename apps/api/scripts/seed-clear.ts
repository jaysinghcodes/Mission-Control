/**
 * seed-clear.ts — `npm run seed:clear`.
 *
 * Deletes only the rows `npm run seed:demo` creates. Registered bots,
 * snapshot rows, and rows created through the API stay. An edited mission
 * stays. A doc that no longer matches the sample bytes stays. A usage day
 * the bridge has overwritten stays.
 *
 * Idempotent. A second run deletes nothing and exits 0.
 * Refuses NODE_ENV=production unless SEED_DEMO_ALLOW_PROD=1.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { clearDemoData } from '../src/seed/clear-demo';

function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.endsWith(val[0])) {
      val = val.slice(1, -1);
    }
    if (key && val && process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotenv(join(__dirname, '..', '.env'));
loadDotenv(join(__dirname, '..', '..', '..', '.env'));

if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_ALLOW_PROD !== '1') {
  console.error(
    '[seed:clear] NODE_ENV=production. Refusing to delete demo data. Set SEED_DEMO_ALLOW_PROD=1 to override.',
  );
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mission_control';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main(): Promise<void> {
  const counts = await clearDemoData(prisma);
  console.log(
    `[seed:clear] removed agents=${counts.agents} cronJobs=${counts.cronJobs} projects=${counts.projects} tickets=${counts.tickets} ` +
      `activity=${counts.activity} approvals=${counts.approvals} usage=${counts.usage} runs=${counts.runs} memories=${counts.memories} ` +
      `devices=${counts.devices} mission=${counts.mission} customTools=${counts.customTools} docs=${counts.docsRemoved} docsKept=${counts.docsKept}`,
  );
  console.log('[seed:clear] done. A second run removes nothing and exits 0.');
}

main()
  .catch((err) => {
    console.error('[seed:clear] failed:', err instanceof Error ? err.message : err);
    if ((err as { code?: string })?.code === 'P2021') {
      console.error('[seed:clear] Schema missing. Run `cd apps/api && npx prisma migrate deploy`.');
    } else {
      console.error('[seed:clear] Is Postgres up? `docker compose up -d db` (or the full stack) and check DATABASE_URL.');
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
