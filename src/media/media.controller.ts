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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { JwtUserGuard } from '../common/guards/jwt-user.guard';
import { MediaService } from './media.service';
import { UploadMediaDto } from './dto/upload-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ConvertMediaDto } from './dto/convert-media.dto';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseGuards(ApiKeyGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 150 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    const record = await this.mediaService.upload(file, dto);
    return {
      error: null,
      message: 'Uploaded successfully',
      data: record,
    };
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
