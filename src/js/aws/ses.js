// ses.js - STUBBED AWS SES email sending
// Replaces private/backend/aws/SES.php
// TODO: Implement as a Lambda function called via API Gateway

/**
 * STUBBED: Send an email via SES.
 * Lambda should: accept { from, to: string[], subject, body, date },
 * send via SES, archive to S3 outbox, return { success: true }.
 * @param {Object} mail - { from, to: string[], subject, body, date }
 */
async function sendEmail(mail) {
  console.warn('SES.sendEmail STUBBED - requires Lambda:', {
    from: mail.from,
    to: mail.to,
    subject: mail.subject
  });
  alert('Email sending requires Lambda (not yet implemented).');
  return { success: false, message: 'Email sending requires Lambda (not yet implemented)' };
}

export { sendEmail };
