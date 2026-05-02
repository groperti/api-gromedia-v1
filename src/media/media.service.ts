import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegStatic from 'ffmpeg-static';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../s3/s3.service';
import { MediaRepository } from './media.repository';
import { UploadMediaDto } from './dto/upload-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ConvertMediaDto } from './dto/convert-media.dto';
import { MediaFileDocument } from './schemas/media-file.schema';
import { MediaProcessingGate } from './services/media-processing-gate.service';

if (ffmpegStatic) {
  (ffmpeg as any).setFfmpegPath(ffmpegStatic as unknown as string);
}

// Cap each sharp op at 1 vips thread so concurrent uploads spread across
// the (enlarged) libuv pool instead of fighting for the same N CPUs.
(sharp as any).concurrency(1);

const IMAGE_EXTS = /\.(jpg|jpeg|png|webp|gif|bmp|tiff|avif|heic)$/i;
const VIDEO_EXTS = /\.(mp4|mov|m4v|avi|mkv|webm|mpeg|mpg|3gp|3gpp|ts|m2ts)$/i;
const isImage = (mime: string, name: string) =>
  (mime && mime.startsWith('image/')) || IMAGE_EXTS.test(name || '');
const isVideo = (mime: string, name: string) =>
  (mime && mime.startsWith('video/')) || VIDEO_EXTS.test(name || '');

const DOCUMENT_TYPE_MAP = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.csv', 'text/csv'],
  ['.txt', 'text/plain'],
  ['.rtf', 'application/rtf'],
  ['.odt', 'application/vnd.oasis.opendocument.text'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['.odp', 'application/vnd.oasis.opendocument.presentation'],
  ['.key', 'application/vnd.apple.keynote'],
  ['.pages', 'application/x-iwork-pages-sffpages'],
  ['.numbers', 'application/x-iwork-numbers-sffnumbers'],
]);

const DOCUMENT_MIME_TO_EXT = new Map<string, string>();
DOCUMENT_TYPE_MAP.forEach((mime, ext) => {
  DOCUMENT_MIME_TO_EXT.set(mime, ext);
});

const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;

const isDocument = (mime: string, name: string) =>
  resolveDocumentType(mime, name) !== null;

function resolveDocumentType(
  mime: string,
  name: string,
): { ext: string; contentType: string } | null {
  const lowerExt = (path.extname(name || '') || '').toLowerCase();
  if (lowerExt && DOCUMENT_TYPE_MAP.has(lowerExt)) {
    return { ext: lowerExt, contentType: DOCUMENT_TYPE_MAP.get(lowerExt)! };
  }

  const normalizedMime = (mime || '').toLowerCase();
  if (normalizedMime && DOCUMENT_MIME_TO_EXT.has(normalizedMime)) {
    const ext = DOCUMENT_MIME_TO_EXT.get(normalizedMime)!;
    return { ext, contentType: DOCUMENT_TYPE_MAP.get(ext)! };
  }

  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function shortId(): string {
  return uuidv4().replace(/-/g, '').slice(0, 6);
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private watermarkCache: Buffer | null = null;
  private wmPath: string;

  private avifQuality: number;
  private avifEffort: number;
  private wmRatio: number;
  private wmOpacity: number;
  private maxWidth: number;
  private cdnBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Service: S3Service,
    private readonly mediaRepo: MediaRepository,
    private readonly gate: MediaProcessingGate,
  ) {}

  onModuleInit() {
    this.avifQuality = this.configService.get<number>('image.avifQuality');
    this.avifEffort = this.configService.get<number>('image.avifEffort');
    this.wmRatio = this.configService.get<number>('image.wmRatio');
    this.wmOpacity = this.configService.get<number>('image.wmOpacity');
    this.maxWidth = this.configService.get<number>('image.maxWidth');
    this.cdnBaseUrl = this.configService.get<string>('cdnBaseUrl');
    this.wmPath = path.join(__dirname, '..', 'assets', 'watermark-logo.png');
  }

  buildPublicUrl(key: string): string {
    return `${this.cdnBaseUrl}/${key}`;
  }

  private async loadWatermark(): Promise<Buffer | null> {
    if (this.watermarkCache) return this.watermarkCache;
    try {
      this.watermarkCache = await fs.readFile(this.wmPath);
      return this.watermarkCache;
    } catch {
      this.logger.warn('watermark-logo.png not found, skipping watermark');
      return null;
    }
  }

  private async buildWatermarkWithOpacity(
    logoBuf: Buffer,
    targetWidth: number,
  ): Promise<Buffer> {
    let s = (sharp as any)(logoBuf).ensureAlpha();
    s = s.resize({ width: targetWidth });
    const logoPng: Buffer = await s.png().toBuffer();

    const meta = await (sharp as any)(logoPng).metadata();
    const w = meta.width || targetWidth || 256;
    const h = meta.height || Math.round(w * 0.3);

    const alpha: Buffer = await (sharp as any)(logoPng).extractChannel('alpha').raw().toBuffer();
    const rgb: Buffer = await (sharp as any)(logoPng).removeAlpha().png().toBuffer();

    const f = Math.max(0, Math.min(1, this.wmOpacity));
    const scaled = Buffer.allocUnsafe(alpha.length);
    for (let i = 0; i < alpha.length; i++) {
      scaled[i] = Math.round(alpha[i] * f);
    }

    return (sharp as any)(rgb)
      .joinChannel(scaled, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toBuffer();
  }

  private async applyWatermark(buffer: Buffer): Promise<Buffer> {
    const wm = await this.loadWatermark();
    if (!wm) return buffer;

    const meta = await (sharp as any)(buffer, { failOnError: false }).metadata();
    if (!meta.width) return buffer;

    const logoW = Math.max(96, Math.round(meta.width * this.wmRatio));
    const mark = await this.buildWatermarkWithOpacity(wm, logoW);

    let img = (sharp as any)(buffer, { failOnError: false });
    if ((meta.format || '').toLowerCase() === 'jpeg' && meta.hasAlpha) {
      img = img.flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } });
    }

    return img
      .composite([{ input: mark, gravity: 'center', blend: 'over' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  private async autoCropEdges(buffer: Buffer): Promise<Buffer> {
    const img = (sharp as any)(buffer, { failOnError: false, limitInputPixels: false });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return buffer;

    const alphaAnalysisSize = 512;
    const alphaThreshold = 18;
    const trimThreshold = 20;
    const minGainRatio = 0.01;
    const padding = 4;

    if (meta.hasAlpha) {
      const scale = Math.min(1, alphaAnalysisSize / Math.max(meta.width, meta.height));
      const wSmall = Math.max(1, Math.round(meta.width * scale));
      const hSmall = Math.max(1, Math.round(meta.height * scale));

      const small = await img
        .clone()
        .resize(wSmall, hSmall, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { data, info } = small;
      let minX = wSmall, minY = hSmall, maxX = -1, maxY = -1;

      for (let y = 0; y < hSmall; y++) {
        for (let x = 0; x < wSmall; x++) {
          const a = data[(y * wSmall + x) * info.channels + 3];
          if (a > alphaThreshold) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0 || maxY < 0) return buffer;

      const inv = 1 / scale;
      const left = Math.max(0, Math.floor(minX * inv) - padding);
      const top = Math.max(0, Math.floor(minY * inv) - padding);
      const right = Math.min(meta.width, Math.ceil((maxX + 1) * inv) + padding);
      const bottom = Math.min(meta.height, Math.ceil((maxY + 1) * inv) + padding);
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);

      const reducedW = 1 - width / meta.width;
      const reducedH = 1 - height / meta.height;
      if (reducedW < minGainRatio && reducedH < minGainRatio) return buffer;

      return img.extract({ left, top, width, height }).png().toBuffer();
    }

    const trimmed = await img.clone().trim({ threshold: trimThreshold }).toBuffer({ resolveWithObject: true });
    const { data: _d, info: infoTrim } = trimmed;

    const reducedW = 1 - infoTrim.width / meta.width;
    const reducedH = 1 - infoTrim.height / meta.height;
    if (reducedW < minGainRatio && reducedH < minGainRatio) {
      return img.png().toBuffer();
    }

    return trimmed.data;
  }

  private transcodeVideoToMp4(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      (ffmpeg as any)(inputPath)
        .outputOptions([
          '-movflags', 'faststart',
          '-pix_fmt', 'yuv420p',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-vf', "scale='min(1280,iw)':-2",
          '-c:a', 'aac',
          '-b:a', '128k',
        ])
        .format('mp4')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outputPath);
    });
  }

  /** Layer 2: Wrap any encode-bound work with admission control. */
  private async runGated<T>(fn: () => Promise<T>): Promise<T> {
    await this.gate.acquire();
    try {
      return await fn();
    } finally {
      this.gate.release();
    }
  }

  async upload(
    file: Express.Multer.File,
    dto: UploadMediaDto,
  ): Promise<MediaFileDocument> {
    return this.runGated(() => this.doUpload(file, dto));
  }

  private async doUpload(
    file: Express.Multer.File,
    dto: UploadMediaDto,
  ): Promise<MediaFileDocument> {
    const mime = file.mimetype || '';
    const originalNameRaw = file.originalname || '';
    const originalName = originalNameRaw.toLowerCase();

    const derivedTitle = (dto.title ?? '').trim() || originalNameRaw.replace(/\.[^.]+$/, '').trim();
    const baseSlugInput = derivedTitle;
    const baseName = baseSlugInput
      ? `${slugify(baseSlugInput)}-${shortId()}`
      : uuidv4();
    const appliedTitle = derivedTitle || undefined;

    if (isImage(mime, originalName)) {
      if (file.size > 20 * 1024 * 1024) {
        throw new BadRequestException('Image max size is 20MB');
      }

      let imgBuf: Buffer;
      try {
        imgBuf = await (sharp as any)(file.path)
          .resize({ width: this.maxWidth, withoutEnlargement: true })
          .toBuffer();
      } catch {
        // sharp couldn't decode (corrupt/unknown header) — fall back to forced
        // PNG decode via buffer. This still keeps memory below the input size
        // because of the resize cap.
        const raw = await fs.readFile(file.path);
        imgBuf = await (sharp as any)(raw, { failOnError: false })
          .png()
          .resize({ width: this.maxWidth, withoutEnlargement: true })
          .toBuffer();
      }

      if (dto.watermark) {
        imgBuf = await this.applyWatermark(imgBuf);
      }

      const avifBuf: Buffer = await (sharp as any)(imgBuf)
        .avif({
          quality: this.avifQuality,
          effort: this.avifEffort,
          chromaSubsampling: '4:2:0',
        })
        .toBuffer();

      const meta = await (sharp as any)(avifBuf).metadata();
      const key = `${dto.userId}/${baseName}.avif`;
      await this.s3Service.upload(key, avifBuf, 'image/avif');

      const record = await this.mediaRepo.create({
        userId: dto.userId,
        folder: dto.userId,

        key,
        slug: baseName,
        publicUrl: this.buildPublicUrl(key),
        title: appliedTitle,
        originalName: file.originalname,
        mimeType: 'image/avif',
        fileSize: avifBuf.length,
        width: meta.width || null,
        height: meta.height || null,
        tags: dto.tags || [],
      });

      return record;
    }

    if (isVideo(mime, originalName)) {
      if (file.size > 100 * 1024 * 1024) {
        throw new BadRequestException('Video max size is 100MB');
      }

      const tmpOut = path.join(os.tmpdir(), `${uuidv4()}_out.mp4`);

      let uploadedBody: Buffer;
      try {
        await this.transcodeVideoToMp4(file.path, tmpOut);
        uploadedBody = await fs.readFile(tmpOut);
      } catch (e) {
        this.logger.error('ffmpeg transcode failed, using original file', e);
        uploadedBody = await fs.readFile(file.path);
      } finally {
        try { await fs.unlink(tmpOut); } catch { }
      }

      const key = `${dto.userId}/${baseName}.mp4`;
      await this.s3Service.upload(key, uploadedBody, 'video/mp4');

      const record = await this.mediaRepo.create({
        userId: dto.userId,
        folder: dto.userId,

        key,
        slug: baseName,
        publicUrl: this.buildPublicUrl(key),
        title: appliedTitle,
        originalName: file.originalname,
        mimeType: 'video/mp4',
        fileSize: uploadedBody.length,
        tags: dto.tags || [],
      });

      return record;
    }

    if (isDocument(mime, originalName)) {
      if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
        throw new BadRequestException('Document max size is 20MB');
      }

      const typeInfo = resolveDocumentType(mime, originalName);
      if (!typeInfo) {
        throw new BadRequestException('Unsupported document type');
      }

      const key = `${dto.userId}/${baseName}${typeInfo.ext}`;
      const contentType = typeInfo.contentType || mime || 'application/octet-stream';

      const docBuf = await fs.readFile(file.path);
      await this.s3Service.upload(key, docBuf, contentType);

      const record = await this.mediaRepo.create({
        userId: dto.userId,
        folder: dto.userId,

        key,
        slug: baseName,
        publicUrl: this.buildPublicUrl(key),
        title: appliedTitle,
        originalName: file.originalname,
        mimeType: contentType,
        fileSize: file.size,
        tags: dto.tags || [],
      });

      return record;
    }

    throw new BadRequestException('Unsupported file type. Only images, videos, and documents are allowed.');
  }

  async uploadJpg(
    file: Express.Multer.File,
    dto: UploadMediaDto,
  ): Promise<MediaFileDocument> {
    return this.runGated(() => this.doUploadJpg(file, dto));
  }

  private async doUploadJpg(
    file: Express.Multer.File,
    dto: UploadMediaDto,
  ): Promise<MediaFileDocument> {
    const mime = file.mimetype || '';
    const originalName = (file.originalname || '').toLowerCase();

    if (!isImage(mime, originalName)) {
      throw new BadRequestException('Only image files are supported for JPG upload');
    }

    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('Image max size is 20MB');
    }

    const derivedTitle = (dto.title ?? '').trim() || file.originalname.replace(/\.[^.]+$/, '').trim();
    const baseName = derivedTitle
      ? `${slugify(derivedTitle)}-${shortId()}`
      : uuidv4();
    const appliedTitle = derivedTitle || undefined;

    let imgBuf: Buffer;
    try {
      imgBuf = await (sharp as any)(file.path)
        .resize({ width: this.maxWidth, withoutEnlargement: true })
        .toBuffer();
    } catch {
      const raw = await fs.readFile(file.path);
      imgBuf = await (sharp as any)(raw, { failOnError: false })
        .png()
        .resize({ width: this.maxWidth, withoutEnlargement: true })
        .toBuffer();
    }

    if (dto.watermark) {
      imgBuf = await this.applyWatermark(imgBuf);
    }

    const jpgBuf: Buffer = await (sharp as any)(imgBuf)
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    const meta = await (sharp as any)(jpgBuf).metadata();
    const key = `${dto.userId}/${baseName}.jpg`;
    await this.s3Service.upload(key, jpgBuf, 'image/jpeg');

    const record = await this.mediaRepo.create({
      userId: dto.userId,
      folder: dto.userId,
      key,
      slug: baseName,
      publicUrl: this.buildPublicUrl(key),
      title: appliedTitle,
      originalName: file.originalname,
      mimeType: 'image/jpeg',
      fileSize: jpgBuf.length,
      width: meta.width || null,
      height: meta.height || null,
      tags: dto.tags || [],
    });

    return record;
  }

  async getPublicLibrary(
    page: number,
    limit: number,
    type?: string,
    userId?: string,
  ) {
    const filter: any = {};
    if (userId) filter.userId = userId;
    if (type === 'image') filter.mimeType = /^image\//i;
    else if (type === 'video') filter.mimeType = /^video\//i;
    else if (type === 'file') filter.mimeType = { $not: /^image\/|^video\//i };
    return this.mediaRepo.findPaginated(filter, page, limit);
  }

  async getLibrary(
    userId: string,
    page: number,
    limit: number,
    type?: string,
  ) {
    const filter: any = { userId };
    if (type === 'image') filter.mimeType = /^image\//i;
    else if (type === 'video') filter.mimeType = /^video\//i;
    else if (type === 'file') filter.mimeType = { $not: /^image\/|^video\//i };
    return this.mediaRepo.findPaginated(filter, page, limit);
  }

  async getOne(id: string, userId: string): Promise<MediaFileDocument> {
    const record = await this.mediaRepo.findById(id);
    if (!record) throw new NotFoundException('Media not found');
    if (record.userId !== userId) throw new ForbiddenException('Access denied');
    return record;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateMediaDto,
  ): Promise<MediaFileDocument> {
    const record = await this.mediaRepo.findById(id);
    if (!record) throw new NotFoundException('Media not found');
    if (record.userId !== userId) throw new ForbiddenException('Access denied');

    const updated = await this.mediaRepo.updateById(id, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
    });

    return updated;
  }

  async remove(id: string): Promise<{ message: string }> {
    const record = await this.mediaRepo.findById(id);
    if (!record) throw new NotFoundException('Media not found');
    if (record.isDefault) throw new ForbiddenException('Default media cannot be deleted');

    await this.s3Service.delete(record.key);

    if (record.jpgUrl) {
      const jpgKey = record.key.replace(/\.[^.]+$/, '.jpg');
      await this.s3Service.delete(jpgKey).catch(() => {});
    }
    if (record.webpUrl) {
      const webpKey = record.key.replace(/\.[^.]+$/, '.webp');
      await this.s3Service.delete(webpKey).catch(() => {});
    }
    if (record.pngUrl) {
      const pngKey = record.key.replace(/\.[^.]+$/, '.png');
      await this.s3Service.delete(pngKey).catch(() => {});
    }

    await this.mediaRepo.deleteById(id);
    return { message: 'Media deleted successfully' };
  }

  async seedDefaults(items: {
    key: string;
    publicUrl: string;
    title: string;
    mimeType: string;
    fileSize: number;
    width?: number;
    height?: number;
    tags?: string[];
  }[]): Promise<MediaFileDocument[]> {
    const results: MediaFileDocument[] = [];
    for (const item of items) {
      const existing = await this.mediaRepo.findOne({ key: item.key });
      if (existing) {
        const updated = await this.mediaRepo.updateById(existing.id, {
          ...item,
          isDefault: true,
          userId: 'system',
          folder: 'system',
          slug: item.key.split('/').pop()?.replace(/\.[^.]+$/, '') || item.key,
          originalName: item.key.split('/').pop() || item.key,
        });
        results.push(updated);
      } else {
        const record = await this.mediaRepo.create({
          ...item,
          isDefault: true,
          userId: 'system',
          folder: 'system',
          slug: item.key.split('/').pop()?.replace(/\.[^.]+$/, '') || item.key,
          originalName: item.key.split('/').pop() || item.key,
          tags: item.tags || [],
        });
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Resolve the source S3 key from any of: existing media record id, raw S3 key,
   * or a public URL hosted on this CDN.
   */
  private extractKeyFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      const cdn = new URL(this.cdnBaseUrl);
      // Same host as the configured CDN bucket
      if (u.host === cdn.host) {
        return u.pathname.replace(/^\/+/, '');
      }
      // Custom CDN domain (e.g. img.groperti.com) — accept any path that
      // starts with a userId-like segment. This matches the upload key shape
      // `<userId>/<filename>.<ext>` written by `upload()`.
      if (u.pathname && u.pathname.length > 1) {
        return u.pathname.replace(/^\/+/, '');
      }
      return null;
    } catch {
      return null;
    }
  }

  async convert(
    dto: ConvertMediaDto,
  ): Promise<MediaFileDocument | { key: string; publicUrl: string; jpgUrl?: string; webpUrl?: string; pngUrl?: string }> {
    return this.runGated(() => this.doConvert(dto));
  }

  private async doConvert(
    dto: ConvertMediaDto,
  ): Promise<MediaFileDocument | { key: string; publicUrl: string; jpgUrl?: string; webpUrl?: string; pngUrl?: string }> {
    const ext = dto.format;
    const urlField = ext === 'jpg' ? 'jpgUrl' : ext === 'webp' ? 'webpUrl' : 'pngUrl';

    // 1. Resolve the source key (from id → record, or directly from key/url)
    let record: MediaFileDocument | null = null;
    let sourceKey: string | null = null;

    if (dto.id) {
      record = await this.mediaRepo.findById(dto.id);
      if (!record) throw new NotFoundException('Media not found');
      sourceKey = record.key;
    } else if (dto.key) {
      sourceKey = dto.key;
      record = await this.mediaRepo.findOne({ key: sourceKey });
    } else if (dto.url) {
      sourceKey = this.extractKeyFromUrl(dto.url);
      if (!sourceKey) throw new BadRequestException('Could not extract S3 key from url');
      record = await this.mediaRepo.findOne({ key: sourceKey });
    } else {
      throw new BadRequestException('One of id, key, or url is required');
    }

    if (!sourceKey) throw new NotFoundException('Source media key could not be resolved');

    const targetKey = sourceKey.replace(/\.[^.]+$/, `.${ext}`);
    const targetPublicUrl = this.buildPublicUrl(targetKey);

    // 2. Fast-path on the DB: existing record already has the converted URL.
    if (record && record[urlField]) {
      return record;
    }

    // 3. Fast-path on S3: target file already exists (e.g. converted previously
    //    by a stateless caller). Reuse it without re-encoding.
    if (await this.s3Service.exists(targetKey)) {
      if (record) {
        return this.mediaRepo.updateById(record.id, { [urlField]: targetPublicUrl });
      }
      return { key: targetKey, publicUrl: targetPublicUrl, [urlField]: targetPublicUrl };
    }

    // 4. Slow path: download original, convert via sharp, upload target.
    if (!(await this.s3Service.exists(sourceKey))) {
      throw new NotFoundException(`Source object missing on S3: ${sourceKey}`);
    }
    const sourceBuf = await this.s3Service.download(sourceKey);

    let convertedBuf: Buffer;
    let contentType: string;

    if (ext === 'jpg') {
      convertedBuf = await (sharp as any)(sourceBuf, { failOnError: false })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      contentType = 'image/jpeg';
    } else if (ext === 'webp') {
      convertedBuf = await (sharp as any)(sourceBuf, { failOnError: false })
        .webp({ quality: 80 })
        .toBuffer();
      contentType = 'image/webp';
    } else {
      convertedBuf = await (sharp as any)(sourceBuf, { failOnError: false })
        .png({ compressionLevel: 8 })
        .toBuffer();
      contentType = 'image/png';
    }

    await this.s3Service.upload(targetKey, convertedBuf, contentType);

    if (record) {
      return this.mediaRepo.updateById(record.id, { [urlField]: targetPublicUrl });
    }

    // No DB record (e.g. legacy uploads or external callers). Return a minimal
    // shape that mirrors the record-bearing branch for the consumer.
    return { key: targetKey, publicUrl: targetPublicUrl, [urlField]: targetPublicUrl };
  }
}
