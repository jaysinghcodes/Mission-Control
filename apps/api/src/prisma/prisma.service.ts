import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PrismaService — Prisma 7 client wired with the pg driver adapter.
 *
 * Prisma 7 requires a driver adapter (no more embedded url in schema).
 * The connection string comes from DATABASE_URL at runtime; for local dev
 * that's `postgresql://postgres:postgres@localhost:5432/mission_control`
 * (see prisma.config.ts fallback).
 *
 * If `prisma migrate deploy` cannot reach the database, the process exits.
 * After migrations apply, a connect failure sets `dbReady` to false and
 * /health reports degraded, so the dashboard shows that state.
 *
 * Database schema is a security red line (vibe-dev-workflow): migrations are
 * human reviewed. boot.ts runs `prisma migrate deploy` before listen. It
 * applies those reviewed files. It does not create new migrations.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /** True once $connect() succeeded. Read by HealthController for honest status. */
  private dbReadyFlag = false;

  constructor() {
    // Production refuses to fall back to a hardcoded local URL — fail fast
    // with a clear message instead of silently targeting the wrong DB.
    const url = process.env.DATABASE_URL;
    if (!url && process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production');
    }
    const adapter = new PrismaPg({
      connectionString:
        url ?? 'postgresql://postgres:postgres@localhost:5432/mission_control',
    });
    super({ adapter });
  }

  /** Whether the database connection is currently healthy (for /health). */
  get dbReady(): boolean {
    return this.dbReadyFlag;
  }

  async onModuleInit(): Promise<void> {
    // Lazy connect; if DB is down, mark degraded — health endpoint reports it,
    // the app stays up, and the UI shows real status instead of fake green.
    try {
      await this.$connect();
      this.dbReadyFlag = true;
    } catch {
      this.dbReadyFlag = false;

      console.warn(
        '[prisma] database unavailable — health will report degraded',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
