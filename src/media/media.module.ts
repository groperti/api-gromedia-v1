import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaFile, MediaFileSchema } from './schemas/media-file.schema';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaFile.name, schema: MediaFileSchema },
    ]),
    S3Module,
  ],
  providers: [MediaRepository, MediaService],
  controllers: [MediaController],
})
export class MediaModule {}
