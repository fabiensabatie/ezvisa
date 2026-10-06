import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Object storage used for client documents and template files. */
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Size in bytes, or null when the object does not exist. */
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  uploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  downloadUrl(key: string, filename: string, expiresInSeconds: number): Promise<string>;
}

export type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** Railway Buckets in production, S3Mock locally. */
export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Object ${key} has no body`);
    return result.Body.transformToByteArray();
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  uploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  downloadUrl(key: string, filename: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, "")}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}

/** In-memory storage for tests and for running without a bucket. */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Object ${key} does not exist`);
    return object.body;
  }

  async size(key: string): Promise<number | null> {
    return this.objects.get(key)?.body.byteLength ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async uploadUrl(key: string): Promise<string> {
    return `memory://upload/${key}`;
  }

  async downloadUrl(key: string): Promise<string> {
    return `memory://download/${key}`;
  }
}

/**
 * Builds storage from S3_* (or BACKUP_S3_*) variables. Returns null when they are not set,
 * so the server still starts and document operations report the missing configuration.
 */
export function storageFromEnv(prefix: "S3" | "BACKUP_S3" = "S3"): Storage | null {
  const env = (name: string) => process.env[`${prefix}_${name}`]?.trim() || undefined;
  const endpoint = env("ENDPOINT");
  const bucket = env("BUCKET");
  const accessKeyId = env("ACCESS_KEY_ID");
  const secretAccessKey = env("SECRET_ACCESS_KEY");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return new S3Storage({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env("REGION") ?? "auto",
    forcePathStyle: env("FORCE_PATH_STYLE") === "true",
  });
}
