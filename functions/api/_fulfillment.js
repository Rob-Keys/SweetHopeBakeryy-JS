import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

const ORDER_BUCKET = 'sweethopebakeryy';
const PICKUP_ADDRESS = 'Arlington, VA, 22207';
const CLAIM_LEASE_MS = 2 * 60 * 1000;

export class NotificationDeliveryError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'NotificationDeliveryError';
    this.result = result;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateForDisplay(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  return match ? `${match[2]}-${match[3]}-${match[1]}` : '';
}

function formatPrice(amount) {
  return Number(amount).toFixed(2);
}

function buildCustomerReceipt(cart, cartTotal, details) {
  let body = `<h3>Thank you for your order with Sweet Hope Bakery!</h3>\n\n`;
  body += `<div style='background-color: #d4edda; border: 1px solid #28a745; padding: 15px; margin: 15px 0;'>`;
  body += `<strong>Payment successful!</strong> Your order has been confirmed.`;
  body += `</div>\n\n`;

  if (details.acquisition_method === 'delivery') {
    body += `<h4>Delivery Details:</h4>`;
    body += `<p>Delivery Address: ${escapeHtml(details.delivery_address)}</p>`;
    body += `<p>Requested Delivery on ${formatDateForDisplay(details.acquisition_date)}</p>`;
  } else {
    body += `<h4>Pickup Details:</h4>`;
    body += `<p>${escapeHtml(PICKUP_ADDRESS)}</p>`;
    body += `<p>Requested Pickup Date: ${formatDateForDisplay(details.acquisition_date)}</p>`;
    body += `<p>Coordinate a pickup time on your chosen day by texting 703-996-9846.</p>`;
  }

  body += `<h4>Summary:</h4>`;
  for (const [name, item] of Object.entries(cart)) {
    body += `<p>${Number(item.quantity)} x ${escapeHtml(item.name || name)}: $${formatPrice(item.price)}</p>`;
    if (Array.isArray(item.customizations) && item.customizations.length) {
      body += `<p style='margin-top:-10px;color:#6b5a49;'><small>Add-ons: ${item.customizations.map(escapeHtml).join(', ')}</small></p>`;
    }
  }
  body += `<p><strong>Total: $${formatPrice(cartTotal)}</strong></p>`;
  body += `<hr><p>Thank you for your business!</p>`;
  body += `<p>We will contact you to coordinate pickup details.</p>`;
  body += `<p>For any questions, please contact support@sweethopebakeryy.com</p>`;
  body += `<img src='https://sweethopebakeryy.s3.us-east-1.amazonaws.com/header/sweethopebakeryy.avif' alt='Sweet Hope Bakery Logo' style='width:200px;height:auto;'/>`;

  return { subject: 'Your Sweet Hope Bakery Order Confirmation', body };
}

function buildOwnerNotification(cart, cartTotal, details) {
  const customerReceipt = buildCustomerReceipt(cart, cartTotal, details);
  let body = `<h3>New order received with the following details:</h3>\n\n`;
  body += `<div style='background-color: #d4edda; border: 1px solid #28a745; padding: 15px; margin: 15px 0;'>`;
  body += `<strong>Payment received via Stripe!</strong>`;
  body += `</div>\n\n`;
  body += `<h4>Customer Contact Info:</h4>`;
  body += `<p>Name: ${escapeHtml(details.customer_name)}</p>`;
  body += `<p>Email: ${escapeHtml(details.customer_email)}</p>`;
  body += `<p>Phone: ${escapeHtml(details.customer_phone)}</p>`;
  body += customerReceipt.body;
  const subject = `New Order: ${details.acquisition_method}: ${formatDateForDisplay(details.acquisition_date)}`;
  return { subject, body };
}

function isNotFound(err) {
  return err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound';
}

function isConditionalConflict(err) {
  return err?.$metadata?.httpStatusCode === 412 || err?.$metadata?.httpStatusCode === 409 ||
    ['PreconditionFailed', 'ConditionalRequestConflict'].includes(err?.name);
}

async function hashRecipient(recipientType, email) {
  const input = new TextEncoder().encode(`${recipientType}:${email.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readNotificationState(s3, key) {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: ORDER_BUCKET, Key: key }));
    return {
      state: JSON.parse(await result.Body.transformToString()),
      etag: result.ETag
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function claimNotification(s3, sessionId, recipientType, email) {
  const emailHash = await hashRecipient(recipientType, email);
  const key = `orders/${sessionId}/notifications/${emailHash}.json`;
  const now = Date.now();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await readNotificationState(s3, key);
    if (existing?.state.status === 'sent') return { status: 'sent', key };
    if (existing?.state.status === 'sending' && Number(existing.state.leaseUntil) > now) {
      return { status: 'pending', key };
    }

    const claim = {
      session_id: sessionId,
      recipient_type: recipientType,
      status: 'sending',
      attempt: Number(existing?.state.attempt || 0) + 1,
      updated_at: new Date(now).toISOString(),
      leaseUntil: now + CLAIM_LEASE_MS
    };
    try {
      await s3.send(new PutObjectCommand({
        Bucket: ORDER_BUCKET,
        Key: key,
        Body: JSON.stringify(claim),
        ContentType: 'application/json',
        ...(existing ? { IfMatch: existing.etag } : { IfNoneMatch: '*' })
      }));
      const claimed = await readNotificationState(s3, key);
      return { status: 'claimed', key, etag: claimed?.etag, claim };
    } catch (err) {
      if (!isConditionalConflict(err)) throw err;
    }
  }

  return { status: 'pending', key };
}

async function updateClaim(s3, claim, status, extra = {}) {
  if (!claim.etag) throw new Error('Notification claim did not return an ETag');
  const next = {
    ...claim.claim,
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  delete next.leaseUntil;
  await s3.send(new PutObjectCommand({
    Bucket: ORDER_BUCKET,
    Key: claim.key,
    Body: JSON.stringify(next),
    ContentType: 'application/json',
    IfMatch: claim.etag
  }));
}

async function sendEmail(ses, from, to, subject, body) {
  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: { Subject: { Data: subject }, Body: { Html: { Data: body } } }
  }));
}

export async function fulfillPaidOrder(context, session, order) {
  const {
    AWS_KEY,
    AWS_SECRET_KEY,
    AWS_REGION = 'us-east-1',
    CAROLINE_EMAIL_ADDRESS,
    DEVELOPER_EMAIL_ADDRESS
  } = context.env;
  if (!AWS_KEY || !AWS_SECRET_KEY) throw new Error('Order notification storage is unavailable');
  if (!order?.customerDetails?.customer_email) throw new Error('Order fulfillment details are missing');

  const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
  const s3 = new S3Client({ region: AWS_REGION, credentials });
  const ses = new SESClient({ region: AWS_REGION, credentials });
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: ORDER_BUCKET,
      Key: `orders/${session.id}.json`
    }));
    // Older versions wrote this marker even when an SES send failed. Avoid a
    // potentially duplicate resend, but report delivery as unknown to the buyer.
    return { customerEmailSent: false, notificationStatus: 'unknown', legacyReceiptMarker: true };
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const details = {
    ...order.customerDetails,
    customer_email: session.customer_details?.email || order.customerDetails.customer_email
  };
  const receipt = buildCustomerReceipt(order.cart, Number(order.cart_total), details);
  const ownerNotification = buildOwnerNotification(order.cart, Number(order.cart_total), details);
  const recipients = [
    { type: 'customer', email: details.customer_email, ...receipt },
    ...(CAROLINE_EMAIL_ADDRESS ? [{ type: 'owner', email: CAROLINE_EMAIL_ADDRESS, ...ownerNotification }] : []),
    ...(DEVELOPER_EMAIL_ADDRESS ? [{ type: 'developer', email: DEVELOPER_EMAIL_ADDRESS, ...ownerNotification }] : [])
  ];
  const statuses = {};
  const failures = [];

  for (const recipient of recipients) {
    const claim = await claimNotification(s3, session.id, recipient.type, recipient.email);
    if (claim.status === 'sent') {
      statuses[recipient.type] = 'sent';
      continue;
    }
    if (claim.status === 'pending') {
      statuses[recipient.type] = 'pending';
      failures.push(recipient.type);
      continue;
    }

    try {
      await sendEmail(ses, 'support@sweethopebakeryy.com', recipient.email, recipient.subject, recipient.body);
      await updateClaim(s3, claim, 'sent', { sent_at: new Date().toISOString() });
      statuses[recipient.type] = 'sent';
    } catch (err) {
      try {
        await updateClaim(s3, claim, 'failed', { failure_at: new Date().toISOString() });
      } catch (stateError) {
        console.error(JSON.stringify({
          message: 'notification_state_update_failed',
          sessionId: session.id,
          recipientType: recipient.type,
          errorName: stateError?.name || 'Error'
        }));
      }
      console.error(JSON.stringify({
        message: 'order_notification_failed',
        sessionId: session.id,
        recipientType: recipient.type,
        errorName: err?.name || 'Error'
      }));
      statuses[recipient.type] = 'pending';
      failures.push(recipient.type);
    }
  }

  const result = {
    customerEmailSent: statuses.customer === 'sent',
    notificationStatus: failures.length ? 'pending' : 'sent',
    recipients: statuses
  };
  if (failures.length) {
    throw new NotificationDeliveryError('One or more order notifications need retry', result);
  }
  return result;
}
