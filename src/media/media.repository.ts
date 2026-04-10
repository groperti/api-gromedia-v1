import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { MediaFile, MediaFileDocument } from './schemas/media-file.schema';

@Injectable()
export class MediaRepository {
  constructor(
    @InjectModel(MediaFile.name)
    private readonly model: Model<MediaFileDocument>,
  ) {}

  async create(data: Partial<MediaFile>): Promise<MediaFileDocument> {
    return this.model.create(data);
  }

  async findById(id: string): Promise<MediaFileDocument | null> {
    return this.model.findById(id).exec();
  }

  async findOne(filter: FilterQuery<MediaFileDocument>): Promise<MediaFileDocument | null> {
    return this.model.findOne(filter).exec();
  }

  async findPaginated(
    filter: FilterQuery<MediaFileDocument>,
    page: number,
    limit: number,
  ): Promise<{ data: MediaFileDocument[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const merged = { $or: [filter, { isDefault: true }] };
    const [data, total] = await Promise.all([
      this.model.find(merged).sort({ isDefault: 1, createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(merged).exec(),
    ]);
    return { data, total, page, limit };
  }

  async updateById(id: string, update: Partial<MediaFile>): Promise<MediaFileDocument | null> {
    return this.model.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }
}
