import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
