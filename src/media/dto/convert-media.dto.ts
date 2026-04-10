import { IsIn, IsString } from 'class-validator';

export class ConvertMediaDto {
  @IsString()
  id: string;

  @IsIn(['jpg', 'webp', 'png'])
  format: 'jpg' | 'webp' | 'png';
}
