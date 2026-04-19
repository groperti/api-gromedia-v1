export default () => ({
  port: parseInt(process.env.PORT, 10) || 4881,
  cdnApiKey: process.env.CDN_API_KEY || '',
  mediaPublicApiKey: process.env.MEDIA_PUBLIC_API_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  cdnBaseUrl: process.env.CDN_BASE_URL || 'https://groperti.sin1.contabostorage.com',
  mongo: {
    uri: process.env.MONGO_URI || '',
  },
  s3: {
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET_NAME || 'groperti',
    region: process.env.S3_BUCKET_REGION || 'default',
    endpoint: process.env.S3_ENDPOINT || 'sin1.contabostorage.com',
  },
  image: {
    avifQuality: parseInt(process.env.AVIF_QUALITY, 10) || 52,
    avifEffort: parseInt(process.env.AVIF_EFFORT, 10) || 3,
    wmRatio: parseFloat(process.env.WM_RATIO) || 0.24,
    wmOpacity: parseFloat(process.env.WM_OPACITY) || 0.55,
    maxWidth: parseInt(process.env.IMAGE_MAX_WIDTH, 10) || 1600,
  },
});
