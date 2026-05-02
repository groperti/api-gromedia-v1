import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaFile, MediaFileSchema } from './schemas/media-file.schema';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaProcessingGate } from './services/media-processing-gate.service';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaFile.name, schema: MediaFileSchema },
    ]),
    S3Module,
  ],
  providers: [MediaRepository, MediaService, MediaProcessingGate],
  controllers: [MediaController],
  // Gate is exported so HealthModule can read its snapshot for /readyz.
  exports: [MediaProcessingGate],
})
export class MediaModule {}
