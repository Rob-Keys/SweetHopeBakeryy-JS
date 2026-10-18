// POST /api/upload-images
// Uploads images to S3 without requiring browser-to-S3 CORS access.
// Requires env: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { checkS3Auth } from './_auth.js';
import { isSafeKey } from './_s3.js';
import { describeError } from './_errors.js';

const CONTENT_TYPE_BY_EXTENSION = {
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  webm: 'video/webm'
};

export async function onRequestPost(context) {
  const denied = await checkS3Auth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const formData = await context.request.formData();
    let filenames;
    try {
      filenames = JSON.parse(formData.get('filenames'));
    } catch {
      return Response.json({ error: 'Invalid filenames' }, { status: 400 });
    }
    if (!Array.isArray(filenames) || filenames.length === 0 || filenames.length > 20) {
      return Response.json({ error: 'No filenames provided' }, { status: 400 });
    }
    const files = filenames.map((_, index) => formData.get(`file-${index}`));
    if (files.some(file => !file || typeof file.arrayBuffer !== 'function')) {
      return Response.json({ error: 'Missing upload file' }, { status: 400 });
    }

    for (const filename of filenames) {
      const ext = String(filename).split('.').pop().toLowerCase();
      if (!isSafeKey(filename) || !CONTENT_TYPE_BY_EXTENSION[ext]) {
        return Response.json({ error: 'Invalid filename' }, { status: 400 });
      }
    }

    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    const uploads = await Promise.all(filenames.map(async (filename, index) => {
      const file = files[index];
      const ext = filename.split('.').pop().toLowerCase();
      const contentType = CONTENT_TYPE_BY_EXTENSION[ext];
      await s3.send(new PutObjectCommand({
        Bucket: 'sweethopebakeryy',
        Key: filename,
        Body: new Uint8Array(await file.arrayBuffer()),
        ContentType: contentType
      }));
      const publicUrl = `https://sweethopebakeryy.s3.us-east-1.amazonaws.com/${filename}`;
      return { filename, publicUrl };
    }));

    return Response.json({ uploads });
  } catch (err) {
    const message = describeError(err, 'Image upload');
    console.error('upload-images error:', message);
    return Response.json({ error: message }, { status: 502 });
  }
}
