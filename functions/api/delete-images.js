// POST /api/delete-images
// Deletes images from S3.
// Requires env: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { checkAuth } from './_auth.js';
import { isSafeKey } from './_s3.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const { s3Keys } = await context.request.json();
    if (!Array.isArray(s3Keys) || s3Keys.length === 0) {
      return Response.json({ error: 'No keys provided' }, { status: 400 });
    }

    for (const key of s3Keys) {
      if (!isSafeKey(key)) {
        return Response.json({ error: 'Invalid key' }, { status: 400 });
      }
    }

    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    await s3.send(new DeleteObjectsCommand({
      Bucket: 'sweethopebakeryy',
      Delete: {
        Objects: s3Keys.map(Key => ({ Key }))
      }
    }));

    return Response.json({ success: true });
  } catch (err) {
    console.error('delete-images error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
