import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ConvertMediaDto {
  // One of `id`, `key`, or `url` must be provided. Validators below ensure
  // at least one identifier is present without forcing the caller to send all.
  @ValidateIf((o) => !o.key && !o.url)
  @IsString()
  id?: string;

  @ValidateIf((o) => !o.id && !o.url)
  @IsString()
  key?: string;

  @ValidateIf((o) => !o.id && !o.key)
  @IsString()
  url?: string;

  @IsIn(['jpg', 'webp', 'png'])
  format: 'jpg' | 'webp' | 'png';

  // Optional: when looking up by key/url and no DB record exists yet,
  // we still convert by streaming from S3. Pass `userId` so a record can
  // be auto-created for tracking. Defaults to "external" (no record write).
  @IsOptional()
  @IsString()
  userId?: string;
}
