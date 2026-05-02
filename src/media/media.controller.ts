import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { JwtUserGuard } from '../common/guards/jwt-user.guard';
import { PublicApiKeyGuard } from '../common/guards/public-api-key.guard';
import { MediaService } from './media.service';
import { UploadMediaDto } from './dto/upload-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ConvertMediaDto } from './dto/convert-media.dto';
import { MediaSaturatedFilter } from './filters/media-saturated.filter';

// Disk-backed multer config: keeps multi-MB request bodies off the JS heap so
// concurrent uploads can't OOM the container. Tmp file is unlinked in finally.
const uploadStorage = diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 16);
    cb(null, `gromedia-${uuidv4()}${ext}`);
  },
});

async function safeUnlink(p?: string) {
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch {
    /* tmp may already be gone */
  }
}

@Controller('media')
@UseFilters(MediaSaturatedFilter)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    try {
      const record = await this.mediaService.upload(file, dto);
      return {
        error: null,
        message: 'Uploaded successfully',
        data: record,
      };
    } finally {
      await safeUnlink(file?.path);
    }
  }

  @Post('upload-jpg')
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadJpg(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    try {
      const record = await this.mediaService.uploadJpg(file, dto);
      return {
        error: null,
        message: 'Uploaded successfully',
        data: record,
      };
    } finally {
      await safeUnlink(file?.path);
    }
  }

  @Get('library/public')
  @UseGuards(PublicApiKeyGuard)
  async getPublicLibrary(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('type') type?: string,
    @Query('userId') userId?: string,
  ) {
    const result = await this.mediaService.getPublicLibrary(
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, parseInt(limit, 10) || 20),
      type,
      userId,
    );
    return { error: null, ...result };
  }

  @Get('library')
  @UseGuards(JwtUserGuard)
  async getLibrary(
    @Req() req: Request & { user: any },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('type') type?: string,
  ) {
    const result = await this.mediaService.getLibrary(
      req.user.userId,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, parseInt(limit, 10) || 20),
      type,
    );
    return { error: null, ...result };
  }

  @Post('seed-defaults')
  @UseGuards(ApiKeyGuard)
  async seedDefaults(@Body() body: { items: any[] }) {
    const records = await this.mediaService.seedDefaults(body.items || []);
    return { error: null, message: `Seeded ${records.length} default item(s)`, data: records };
  }

  @Post('convert')
  @UseGuards(ApiKeyGuard)
  async convert(@Body() dto: ConvertMediaDto) {
    const record = await this.mediaService.convert(dto);
    return { error: null, message: 'Converted successfully', data: record };
  }

  @Get(':id')
  @UseGuards(JwtUserGuard)
  async getOne(@Param('id') id: string, @Req() req: Request & { user: any }) {
    const record = await this.mediaService.getOne(id, req.user.userId);
    return { error: null, data: record };
  }

  @Patch(':id')
  @UseGuards(JwtUserGuard)
  async update(
    @Param('id') id: string,
    @Req() req: Request & { user: any },
    @Body() dto: UpdateMediaDto,
  ) {
    const record = await this.mediaService.update(id, req.user.userId, dto);
    return { error: null, message: 'Updated successfully', data: record };
  }

  @Delete(':id')
  @UseGuards(ApiKeyGuard)
  async remove(@Param('id') id: string) {
    return this.mediaService.remove(id);
  }
}
