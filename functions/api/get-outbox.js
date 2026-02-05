// GET /api/get-outbox
// Lists and reads emails from S3 outbox
// Env vars: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional, defaults to us-east-1)

import { S3Client } from '@aws-sdk/client-s3';
import { checkAuth } from './_auth.js';
import { listEmails } from './_s3.js';

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
    const emails = await listEmails(s3, 'outbox/');

    return Response.json({ emails });
  } catch (err) {
    console.error('get-outbox error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
