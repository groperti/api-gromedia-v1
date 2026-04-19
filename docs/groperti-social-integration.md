# api-gromedia-v1 — Integration Guide for `groperti-social`

This document covers the two endpoints that `groperti-social` (Postiz and similar social-publishing services) needs:

1. **Upload an image as JPG** — `POST /media/upload-jpg`
2. **Fetch the public media library** — `GET /media/library/public`

---

## Base URL

```
http://<GROMEDIA_HOST>:<PORT>
```

Default dev port: **4881**

---

## Authentication

### CDN_API_KEY — for upload

Used by `POST /media/upload-jpg`.  
Pass it in the request header:

```
x-api-key: <CDN_API_KEY>
```

### MEDIA_PUBLIC_API_KEY — for library fetch

Used by `GET /media/library/public`.  
This is a **separate** key scoped for external services.  
Pass it in the request header:

```
x-api-key: <MEDIA_PUBLIC_API_KEY>
```

Both keys are set as environment variables on the `api-gromedia-v1` server. Ask the platform team for the values.

---

## 1. Upload Image as JPG

### `POST /media/upload-jpg`

Uploads an image and stores it as a `.jpg` file on S3. Returns the stored record including the public URL.

**Auth header:** `x-api-key: <CDN_API_KEY>`  
**Content-Type:** `multipart/form-data`  
**Max file size:** 20 MB

### Request fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File (binary) | Yes | The image file to upload. Accepted formats: JPG, PNG, WEBP, GIF, BMP, TIFF, AVIF, HEIC. |
| `userId` | string | Yes | Owner identifier. Used as the S3 folder prefix. For `groperti-social`, use a fixed service identifier e.g. `groperti-social`. |
| `title` | string | No | Human-readable title. Used to generate the file slug. Falls back to original filename. |
| `tags` | JSON array string | No | e.g. `["social","listing"]`. Can be a JSON string or comma-separated. |
| `watermark` | boolean string | No | `"true"` to apply the GroPerti watermark logo. Default: no watermark. |

### Example — curl

```bash
curl -X POST http://localhost:4881/media/upload-jpg \
  -H "x-api-key: YOUR_CDN_API_KEY" \
  -F "file=@/path/to/photo.jpg" \
  -F "userId=groperti-social" \
  -F "title=Rumah Mewah Sentul" \
  -F 'tags=["social","listing"]'
```

### Example — JavaScript (fetch)

```js
const form = new FormData();
form.append('file', imageBlob, 'photo.jpg');
form.append('userId', 'groperti-social');
form.append('title', 'Rumah Mewah Sentul');
form.append('tags', JSON.stringify(['social', 'listing']));

const res = await fetch('http://localhost:4881/media/upload-jpg', {
  method: 'POST',
  headers: { 'x-api-key': process.env.CDN_API_KEY },
  body: form,
});

const { data } = await res.json();
console.log(data.publicUrl); // ready-to-use JPG URL
```

### Success response — `200 OK`

```json
{
  "error": null,
  "message": "Uploaded successfully",
  "data": {
    "_id": "6627a1f2c4e3b90012345678",
    "userId": "groperti-social",
    "folder": "groperti-social",
    "key": "groperti-social/rumah-mewah-sentul-a3f9b1.jpg",
    "slug": "rumah-mewah-sentul-a3f9b1",
    "publicUrl": "https://groperti.sin1.contabostorage.com/groperti-social/rumah-mewah-sentul-a3f9b1.jpg",
    "title": "Rumah Mewah Sentul",
    "originalName": "photo.jpg",
    "mimeType": "image/jpeg",
    "fileSize": 284512,
    "width": 1600,
    "height": 1067,
    "tags": ["social", "listing"],
    "isDefault": false,
    "createdAt": "2026-04-19T08:00:00.000Z",
    "updatedAt": "2026-04-19T08:00:00.000Z"
  }
}
```

### Key field to use in Postiz / social publishing

```
data.publicUrl  →  direct HTTPS URL to the JPG file
```

### Error responses

| Status | Reason |
|--------|--------|
| `401` | Missing or wrong `x-api-key` |
| `400` | File is not an image (video/document rejected) |
| `400` | File exceeds 20 MB |

---

## 2. Fetch Public Media Library

### `GET /media/library/public`

Returns a paginated list of media records. No user login required — authenticated only by the public API key.

**Auth header:** `x-api-key: <MEDIA_PUBLIC_API_KEY>`

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (1-based) |
| `limit` | number | `20` | Items per page. Maximum: `100` |
| `type` | string | — | Filter by media type: `image`, `video`, or `file`. Omit for all types. |
| `userId` | string | — | Filter by owner. Pass `groperti-social` to see only files uploaded by this service. Omit to fetch across all users. |

### Example — curl

```bash
# Fetch page 1, images only, uploaded by groperti-social
curl "http://localhost:4881/media/library/public?page=1&limit=20&type=image&userId=groperti-social" \
  -H "x-api-key: YOUR_MEDIA_PUBLIC_API_KEY"
```

```bash
# Fetch page 2 with 50 items
curl "http://localhost:4881/media/library/public?page=2&limit=50&type=image" \
  -H "x-api-key: YOUR_MEDIA_PUBLIC_API_KEY"
```

### Example — JavaScript (fetch)

```js
async function fetchMediaPage(page = 1, limit = 20) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    type: 'image',
    userId: 'groperti-social',
  });

  const res = await fetch(`http://localhost:4881/media/library/public?${params}`, {
    headers: { 'x-api-key': process.env.MEDIA_PUBLIC_API_KEY },
  });

  return res.json();
}

// Fetch first page
const result = await fetchMediaPage(1, 20);
console.log(result.data);  // array of media records
console.log(result.total); // total count for pagination
```

### Success response — `200 OK`

```json
{
  "error": null,
  "data": [
    {
      "_id": "6627a1f2c4e3b90012345678",
      "userId": "groperti-social",
      "key": "groperti-social/rumah-mewah-sentul-a3f9b1.jpg",
      "slug": "rumah-mewah-sentul-a3f9b1",
      "publicUrl": "https://groperti.sin1.contabostorage.com/groperti-social/rumah-mewah-sentul-a3f9b1.jpg",
      "title": "Rumah Mewah Sentul",
      "originalName": "photo.jpg",
      "mimeType": "image/jpeg",
      "fileSize": 284512,
      "width": 1600,
      "height": 1067,
      "tags": ["social", "listing"],
      "isDefault": false,
      "createdAt": "2026-04-19T08:00:00.000Z",
      "updatedAt": "2026-04-19T08:00:00.000Z"
    }
  ],
  "total": 87,
  "page": 1,
  "limit": 20
}
```

### Pagination logic

```
total_pages = Math.ceil(total / limit)
has_next    = page < total_pages
next_page   = page + 1
```

Example: `total: 87`, `limit: 20` → 5 pages. Page 5 has 7 items.

### Error responses

| Status | Reason |
|--------|--------|
| `401` | Missing or wrong `x-api-key` |

---

## Environment variables required on `api-gromedia-v1`

```env
# Existing — used by upload endpoints
CDN_API_KEY=your-cdn-api-key

# New — used by GET /media/library/public
MEDIA_PUBLIC_API_KEY=your-media-public-api-key
```

---

## Typical `groperti-social` workflow

```
1. Agent publishes a listing
        ↓
2. groperti-social calls GET /media/library/public
   ?type=image&userId=groperti-social&page=1&limit=50
        ↓
3. Pick matching image(s) from data[].publicUrl
        ↓
4. Pass publicUrl directly to Postiz as the media URL
        ↓
   (If no suitable image exists)
        ↓
5. Download listing image from groperti CDN
6. POST /media/upload-jpg  (multipart, userId=groperti-social)
7. Use returned data.publicUrl in Postiz
```

---

## Notes for the AI implementing `groperti-social`

- `publicUrl` is a direct HTTPS link — no signed URL, no expiry. Safe to store and reuse.
- JPG upload resizes images to max `1600px` width (preserves aspect ratio). Height is untouched.
- `slug` is URL-safe and unique per file. Safe to use as a deduplication key.
- The library endpoint also returns `isDefault: true` records (platform default images). Filter them out with `item.isDefault === false` if you only want user-uploaded files.
- `limit` is capped at `100` server-side regardless of what you send.
- Both endpoints are stateless — no session, no cookie needed.
