// GET /api/get-inbox
// Lists and reads emails from S3 inbox
// Env vars: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { checkAuth } from './_auth.js';

export async function onRequestGet(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    const list = await s3.send(new ListObjectsV2Command({
      Bucket: 'sweethopebakeryy-emails',
      Prefix: 'inbox/'
    }));

    const emails = [];
    for (const obj of (list.Contents || [])) {
      if (obj.Key === 'inbox/') continue; // skip directory marker
      const data = await s3.send(new GetObjectCommand({
        Bucket: 'sweethopebakeryy-emails',
        Key: obj.Key
      }));
      const text = await data.Body.transformToString();
      try {
        emails.push(JSON.parse(text));
      } catch {
        // If not JSON (raw MIME), return as-is with key as identifier
        emails.push({ key: obj.Key, body: text, date: obj.LastModified });
      }
    }

    return Response.json({ emails });
  } catch (err) {
    console.error('get-inbox error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
