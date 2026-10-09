import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ModelsController: a stored list of provider and model names.
 *
 * The bridge does not read GET /models. This API does not call DeepSeek
 * or Z.ai. Spend on System comes from usage.snapshot.
 */
@Controller('models')
export class ModelsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.modelConfig.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Body() body: { provider?: string; model?: string; label?: string }) {
    const provider = String(body.provider ?? '').trim().toLowerCase();
    const model = String(body.model ?? '').trim();
    if (!provider || !model) {
      throw new HttpException('provider and model are required', HttpStatus.BAD_REQUEST);
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(model)) {
      throw new HttpException('invalid model id', HttpStatus.BAD_REQUEST);
    }
    return this.prisma.modelConfig.create({
      data: {
        provider,
        model,
        label: body.label ? String(body.label).trim().slice(0, 60) || null : null,
      },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.prisma.modelConfig.delete({ where: { id } });
    } catch {
      throw new HttpException('model not found', HttpStatus.NOT_FOUND);
    }
    return { deleted: id };
  }
}
