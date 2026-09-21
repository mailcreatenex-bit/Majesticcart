import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID, createHash } from 'node:crypto';

/**
 * Object storage for payment screenshots and the UPI QR.
 *
 * Uploads are presigned and go straight from the member's phone to S3/R2. The
 * API never handles the bytes — a 4 MB screenshot through a Node process is
 * memory pressure for no benefit, and members on patchy mobile data would be
 * uploading twice.
 *
 * Screenshots are private. They are read through short-lived signed URLs when
 * an admin opens a request, never served from a public bucket: they carry a
 * member's bank app, their name and their transaction history.
 */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

export interface UploadTicket {
  uploadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
  maxBytes: number;
}

@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'majestic-uploads';
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? 'ap-south-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' }
        : undefined,
    });
  }

  /**
   * A ticket to upload one file.
   *
   * The content type and length are pinned into the signature, so the ticket
   * cannot be reused to upload something else: without that, a signed PUT is an
   * open invitation to host arbitrary files in your bucket.
   */
  async createUploadTicket(args: {
    purpose: 'recharge-screenshot' | 'product-image' | 'payment-qr';
    memberId?: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket> {
    if (!ALLOWED.has(args.contentType)) {
      throw new BadRequestException('Upload a JPG, PNG or WebP image.');
    }
    if (!Number.isInteger(args.contentLength) || args.contentLength <= 0 || args.contentLength > MAX_BYTES) {
      throw new BadRequestException(`Images must be under ${MAX_BYTES / 1024 / 1024} MB.`);
    }

    const ext = args.contentType.split('/')[1].replace('jpeg', 'jpg');
    // Date-partitioned so a lifecycle rule can expire old screenshots, and the
    // key is unguessable so knowing one does not reveal another.
    const day = new Date().toISOString().slice(0, 10);
    const objectKey = `${args.purpose}/${day}/${args.memberId ?? 'admin'}-${randomUUID()}.${ext}`;

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: args.contentType,
        ContentLength: args.contentLength,
      }),
      { expiresIn: 300 },
    );

    return { uploadUrl, objectKey, expiresInSeconds: 300, maxBytes: MAX_BYTES };
  }

  /** Short-lived read URL. Screenshots are never public. */
  async signedReadUrl(objectKey: string, expiresIn = 600): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), { expiresIn });
  }

  /**
   * Hash the stored object.
   *
   * This is what catches one screenshot submitted from two accounts, so it has
   * to run against what actually landed in the bucket — not against a hash the
   * client supplied, which the client controls.
   */
  async hashObject(objectKey: string): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new BadRequestException('That upload could not be read. Try again.');
    return createHash('sha256').update(bytes).digest('hex');
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (e) {
      // An orphaned object costs pennies; failing the request costs a member
      // their recharge. Log and move on.
      this.log.warn(`Could not delete ${objectKey}: ${(e as Error).message}`);
    }
  }
}
