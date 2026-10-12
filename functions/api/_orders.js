// Strongly consistent storage for checkout snapshots, with KV fallback for
// sessions created before the S3 snapshot was introduced.

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getKv } from './_kv.js';

const BUCKET = 'sweethopebakeryy';
const SNAPSHOT_PREFIX = 'orders/';

function createS3Client(env) {
  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = env;
  if (!AWS_KEY || !AWS_SECRET_KEY) return null;
  return new S3Client({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY }
  });
}

function snapshotKey(sessionId) {
  return `${SNAPSHOT_PREFIX}${sessionId}.snapshot.json`;
}

function isNotFound(err) {
  return err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound';
}

export async function saveOrderSnapshot(context, sessionId, snapshot) {
  const s3 = createS3Client(context.env);
  if (!s3) throw new Error('AWS credentials are required to save checkout orders');

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: snapshotKey(sessionId),
    Body: JSON.stringify(snapshot),
    ContentType: 'application/json'
  }));

  // Keep the old KV copy during rollout and for existing tooling. S3 is the
  // source of truth because a successful PUT is immediately readable globally.
  const kv = getKv(context);
  if (kv) {
    try {
      await kv.put(`orders/${sessionId}`, JSON.stringify(snapshot), { expirationTtl: 60 * 60 * 24 });
    } catch (err) {
      console.warn('KV order snapshot mirror failed:', err);
    }
  }
}

export async function loadOrderSnapshot(context, sessionId) {
  const s3 = createS3Client(context.env);
  if (s3) {
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: snapshotKey(sessionId)
      }));
      return JSON.parse(await result.Body.transformToString());
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  // Legacy sessions (and local setups without AWS credentials) only have a KV
  // snapshot. New checkout sessions always write the strongly consistent copy.
  const kv = getKv(context);
  if (!kv) return null;
  return await kv.get(`orders/${sessionId}`, 'json');
}
