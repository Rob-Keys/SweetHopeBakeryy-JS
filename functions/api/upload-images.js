// POST /api/upload-images
// Generates presigned S3 upload URLs for images.
// Requires env: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { checkAuth } from './_auth.js';
import { isSafeKey } from './_s3.js';

const ALLOWED_EXTENSIONS = new Set(['avif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'ico']);

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const { filenames } = await context.request.json();
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return Response.json({ error: 'No filenames provided' }, { status: 400 });
    }

    for (const filename of filenames) {
      const ext = String(filename).split('.').pop().toLowerCase();
      if (!isSafeKey(filename) || !ALLOWED_EXTENSIONS.has(ext)) {
        return Response.json({ error: 'Invalid filename' }, { status: 400 });
      }
    }

    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    const uploads = await Promise.all(filenames.map(async (filename) => {
      const ext = filename.split('.').pop().toLowerCase();
      const contentType = ext === 'jpg' ? 'jpeg' : ext;
      const command = new PutObjectCommand({
        Bucket: 'sweethopebakeryy',
        Key: filename,
        ContentType: 'image/' + (contentType || 'avif')
      });
      const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
      const publicUrl = `https://sweethopebakeryy.s3.us-east-1.amazonaws.com/${filename}`;
      return { filename, presignedUrl, publicUrl };
    }));

    return Response.json({ uploads });
  } catch (err) {
    console.error('upload-images error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
