import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config — connection details live here, not in schema.prisma.
 * URL comes from DATABASE_URL (see the repo-root .env / deploy env).
 *
 * Production refuses the localhost fallback (GLM review 🔴 #3): a missing
 * DATABASE_URL in production throws a clear error instead of silently
 * targeting a local database.
 */
function resolveDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }
  return 'postgresql://postgres:postgres@localhost:5432/mission_control';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveDbUrl(),
  },
});
