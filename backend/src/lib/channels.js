import nodemailer from 'nodemailer';

// Delivery channels for notifications and scheduled reports.
// E-mail uses SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).
// SMS uses an HTTP gateway (SMS_GATEWAY_URL, SMS_GATEWAY_TOKEN) so any local provider can be plugged in.
// When a channel is not configured it reports SKIPPED; the in-system notification is always created.

let injectedMail = null;
let injectedSms = null;
/** For tests: replace the real channels. */
export const useTestChannels = ({ mail, sms } = {}) => { injectedMail = mail ?? null; injectedSms = sms ?? null; };

let smtp = null;
function mailTransport() {
  if (injectedMail) return injectedMail;
  if (!process.env.SMTP_HOST) return null;
  smtp ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return smtp;
}

export const channelStatus = () => ({
  email: Boolean(injectedMail || process.env.SMTP_HOST),
  sms: Boolean(injectedSms || process.env.SMS_GATEWAY_URL),
});

export async function sendEmail({ to, subject, text, attachments }) {
  const t = mailTransport();
  if (!t || !to) return 'SKIPPED';
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || 'Jimma Asset Management <no-reply@localhost>', to, subject, text, attachments });
    return 'SENT';
  } catch (err) {
    console.error('E-mail failed:', err.message);
    return 'FAILED';
  }
}

export async function sendSms({ to, text }) {
  if (!to) return 'SKIPPED';
  if (injectedSms) {
    try { await injectedSms({ to, text }); return 'SENT'; } catch { return 'FAILED'; }
  }
  if (!process.env.SMS_GATEWAY_URL) return 'SKIPPED';
  try {
    const res = await fetch(process.env.SMS_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to, message: text.slice(0, 300) }),
    });
    return res.ok ? 'SENT' : 'FAILED';
  } catch (err) {
    console.error('SMS failed:', err.message);
    return 'FAILED';
  }
}
