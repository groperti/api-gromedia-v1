import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';

@Injectable()
export class S3Service implements OnModuleInit {
  private client: S3Client;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const s3Config = this.configService.get('s3');
    this.bucket = s3Config.bucket;

    // Reuse TLS connections to Contabo across uploads. Without keepAlive each
    // PutObject pays a fresh TLS handshake (~30-50ms) which dominates latency
    // for small images at high concurrency.
    const httpsAgent = new HttpsAgent({
      keepAlive: true,
      keepAliveMsecs: 30_000,
      maxSockets: 50,
    });

    this.client = new S3Client({
      credentials: {
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
      },
      region: s3Config.region,
      endpoint: `https://${s3Config.endpoint}`,
      forcePathStyle: true,
      maxAttempts: 3,
      requestHandler: new NodeHttpHandler({
        httpsAgent,
        connectionTimeout: 10_000,
        socketTimeout: 60_000,
      }),
    });
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: 'inline',
        CacheControl: cacheControl || 'public, max-age=31536000, immutable',
        ACL: 'public-read',
      }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
