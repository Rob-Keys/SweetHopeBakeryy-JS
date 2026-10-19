// POST /api/delete-images
// Deletes images from S3.
// Requires env: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { checkS3Auth } from './_auth.js';
import { isSafeKey } from './_s3.js';
import { adminErrorResponse } from './_errors.js';

export async function onRequestPost(context) {
  const denied = await checkS3Auth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'Image deletion failed: AWS credentials not configured' }, { status: 400 });
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

    // New still-image uploads are stored as UUID-w{width}.avif siblings. The
    // content model keeps only the largest URL, so remove its responsive
    // siblings when that image is removed. Missing siblings are harmless S3
    // delete targets; legacy single-file uploads still delete as before.
    const deleteKeys = new Set(s3Keys);
    for (const key of s3Keys) {
      const match = key.match(/^(.*)-w(\d+)\.avif$/i);
      if (!match) continue;
      for (const width of new Set([480, 960, 1600, 2400, Number(match[2])])) {
        deleteKeys.add(`${match[1]}-w${width}.avif`);
      }
    }

    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    const result = await s3.send(new DeleteObjectsCommand({
      Bucket: 'sweethopebakeryy',
      Delete: {
        Objects: [...deleteKeys].map(Key => ({ Key }))
      }
    }));
    if (result.Errors?.length) {
      const details = result.Errors.map(error => `${error.Key || 'unknown key'}: ${error.Code || 'UnknownError'}${error.Message ? ` (${error.Message})` : ''}`);
      const message = `Image deletion failed for ${result.Errors.length} object(s): ${details.join('; ')}`;
      console.error('delete-images partial failure:', message);
      return Response.json({ error: message }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err, 'Image deletion');
  }
}
