// Shared S3 helpers for Cloudflare Pages Functions

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const ALLOWED_PREFIXES = ['images/', 'header/'];

export function isSafeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  if (key === 'sweethopebakeryy.ico') return true;
  return ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function createAwsClients(env, ...ClientClasses) {
  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = env;
  if (!AWS_KEY || !AWS_SECRET_KEY) return null;
  const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
  return ClientClasses.map(C => new C({ region: AWS_REGION, credentials }));
}

export async function listEmails(s3, prefix) {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: 'sweethopebakeryy-emails',
    Prefix: prefix
  }));

  const emails = [];
  for (const obj of (list.Contents || [])) {
    if (obj.Key === prefix) continue;
    const data = await s3.send(new GetObjectCommand({
      Bucket: 'sweethopebakeryy-emails',
      Key: obj.Key
    }));
    const text = await data.Body.transformToString();
    try {
      emails.push(JSON.parse(text));
    } catch {
      emails.push({ key: obj.Key, body: text, date: obj.LastModified });
    }
  }

  return emails;
}
