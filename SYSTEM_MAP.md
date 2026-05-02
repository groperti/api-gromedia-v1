# api-gromedia-v1 — System Map

> **Before doing anything:** read this `SYSTEM_MAP.md` for the side you're touching. Read only the specific files you need — never scan large files end-to-end.
> - Backend → `api-*/SYSTEM_MAP.md`
> - Frontend (web) → `web-*/SYSTEM_MAP.md`
> - Mobile (app) → `app-*/SYSTEM_MAP.md`

## Purpose
Dedicated CDN media library API for Groperti — handles image/video/document uploads, server-side processing (watermarking, AVIF transcoding, ffmpeg), and S3-backed storage with MongoDB metadata.

## Tech stack
- TypeScript
- NestJS 10.x (Express adapter)
- MongoDB + Mongoose (media metadata)
- Contabo Object Storage via `@aws-sdk/client-s3` (S3-compatible, sgp1)
- `sharp` for image processing, `fluent-ffmpeg` for video
- `multer` for multipart, `class-validator` for DTOs, `jsonwebtoken` for x-token auth

## Entry points
- `src/main.ts` — NestJS bootstrap, CORS, ValidationPipe, `PORT` (default 4881)
- `src/app.module.ts` — root module: ConfigModule + MongooseModule + MediaModule
- `src/media/media.controller.ts` — all REST endpoints (upload, convert, library, fetch, update, delete)

## Folder map
- `src/media/` — controller, service, repository, schemas, DTOs (core domain)
- `src/s3/` — `S3Service` wrapping AWS SDK against Contabo endpoint
- `src/common/guards/` — `ApiKeyGuard`, `JwtUserGuard`, `PublicApiKeyGuard`
- `src/config/` — `configuration.ts` env loader
- `docs/` — module documentation
- `dist/` — compiled output

## Key flows
- **Upload** — `POST /media/upload` (multipart) → `MediaController` → `MediaService.upload()` detects type → image: watermark + AVIF transcode (sharp); video: ffmpeg pipeline → `S3Service.upload()` (public-read ACL) → persist `MediaFile` doc.
- **Convert** — `POST /media/convert` (JSON) → resolve media by id/key/url → sharp/ffmpeg to jpg/webp/png → S3 upload → upsert record.
- **Library list** — `GET /media/library` (auth) or `/media/library/public` → filter by `userId` + `type` + folder → paginated via `MediaRepository`.
- **Fetch one** — `GET /media/:id` → `MediaRepository.findById()` → ownership check against JWT `userId` → returns record + formatted CDN URLs.

## External dependencies
- MongoDB (`MONGO_URI`) — media metadata
- Contabo S3 (`S3_ENDPOINT`, sgp1) — asset blobs, public-read
- `CDN_BASE_URL` — public asset URL prefix
- JWT issuer = `api-groperti-v2` — shared `JWT_SECRET` validates `x-token`
- `CDN_API_KEY` / `MEDIA_PUBLIC_API_KEY` — service-to-service `x-api-key` headers
- ffmpeg binary (system) for video transcoding

## Where to look for X
| Task | Path |
|------|------|
| Add upload endpoint / change max size | `src/media/media.controller.ts` (FileInterceptor) + `src/media/media.service.ts` |
| S3 client / presigned URLs | `src/s3/s3.service.ts` + `src/config/configuration.ts` |
| Auth (API key + JWT user) | `src/common/guards/api-key.guard.ts`, `src/common/guards/jwt-user.guard.ts` |
| Watermark / AVIF / auto-crop | `src/media/media.service.ts` (`loadWatermark`, `applyWatermark`, `autoCropEdges`) |
| DB schema / queries | `src/media/schemas/media-file.schema.ts` + `src/media/media.repository.ts` |
| DTO validation | `src/media/dto/` (UploadMediaDto, ConvertMediaDto, UpdateMediaDto) |
| Deploy / env | `.env.example`, `Dockerfile`, `docker-compose.yml` |

## Conventions worth knowing
- **Dual auth**: every protected route requires `ApiKeyGuard` (`x-api-key`) AND `JwtUserGuard` (`x-token` JWT). Public endpoints use `PublicApiKeyGuard` only.
- **JWT secret is shared with `api-groperti-v2`** — never rotate independently.
- **Storage**: Contabo S3-compatible bucket in `sgp1`, all objects uploaded with public-read ACL; serve via `CDN_BASE_URL`, never the raw S3 endpoint.
- **Image pipeline**: AVIF is the default transcoded output (`AVIF_QUALITY`, `AVIF_EFFORT`); watermark applied via `WM_RATIO`/`WM_OPACITY`; resize capped by `IMAGE_MAX_WIDTH`.
- **Video pipeline**: `fluent-ffmpeg` requires the ffmpeg binary on PATH (in Docker image).
- **Mongoose indices**: `MediaFile` is indexed on `(userId, folder)`, `(userId, createdAt)`, `(isDefault, createdAt)` — preserve when adding query filters.
