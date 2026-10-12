import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** SessionsController — real agent sessions (synced via sessions.snapshot). */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const sessions = await this.prisma.session.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return { sessions, ts: Date.now() };
  }
}
