import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MediaFileDocument = MediaFile & Document;

@Schema({ timestamps: true, collection: 'media_files' })
export class MediaFile {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  folder: string;

  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  slug: string;

  @Prop({ required: true })
  publicUrl: string;

  @Prop({ default: null })
  jpgUrl: string;

  @Prop({ default: null })
  webpUrl: string;

  @Prop({ default: null })
  pngUrl: string;

  @Prop()
  title: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ default: null })
  width: number;

  @Prop({ default: null })
  height: number;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: false, index: true })
  isDefault: boolean;
}

export const MediaFileSchema = SchemaFactory.createForClass(MediaFile);

MediaFileSchema.index({ userId: 1, folder: 1 });
MediaFileSchema.index({ userId: 1, createdAt: -1 });
MediaFileSchema.index({ isDefault: 1, createdAt: -1 });
