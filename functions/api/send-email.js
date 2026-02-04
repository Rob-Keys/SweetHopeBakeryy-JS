// POST /api/send-email
// Auth-protected — admin mail compose only
// Sends a single email via AWS SES and archives to S3 outbox
// Env vars: AWS_KEY, AWS_SECRET_KEY, AWS_REGION (optional)

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { checkAuth } from './_auth.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const { from, to, subject, body, date } = await context.request.json();

    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const ses = new SESClient({ region: AWS_REGION, credentials });
    const s3 = new S3Client({ region: AWS_REGION, credentials });

    // Send email
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: body } }
      }
    }));

    // Archive to S3 outbox
    const timestamp = date || Date.now();
    await s3.send(new PutObjectCommand({
      Bucket: 'sweethopebakeryy-emails',
      Key: `outbox/${timestamp}-${Math.random().toString(36).slice(2, 8)}.json`,
      Body: JSON.stringify({ from, to, subject, body, date: timestamp }),
      ContentType: 'application/json'
    }));

    return Response.json({ success: true });
  } catch (err) {
    console.error('send-email error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
