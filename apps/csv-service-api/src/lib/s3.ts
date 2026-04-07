import { S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;
const region = process.env.S3_REGION || 'us-east-1';
const accessKeyId = process.env.S3_ACCESS_KEY || 'minioadmin';
const secretAccessKey = process.env.S3_SECRET_KEY || 'minioadmin';
const s3Options = {
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  requestChecksumCalculation: 'WHEN_REQUIRED' as const,
  responseChecksumValidation: 'WHEN_REQUIRED' as const,
};

// Internal client for server-side operations (get, put, list)
export const s3Client = new S3Client({ ...s3Options, endpoint });

// Public client for generating presigned URLs accessible from browsers
export const s3PublicClient = new S3Client({ ...s3Options, endpoint: publicEndpoint });

export const BUCKET_NAME = process.env.S3_BUCKET || 'ecom-kit-uploads';
