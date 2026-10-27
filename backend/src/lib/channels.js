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
  sms: Boolean(injectedSms || process.env.SMS_GATEWAY_URL || process.env.SMS_GATEWAY_TOKEN || process.env.SMS_TOKEN || process.env.MESSAGING_TOKEN),
});

export async function sendEmail({ to, subject, text, html, attachments }) {
  const t = mailTransport();
  if (!t || !to) {
    if (!t && to) console.log(`[SMTP Email Skipped - SMTP_HOST not configured] To: ${to} | Subject: ${subject}`);
    return 'SKIPPED';
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || 'Jimma Asset Management <no-reply@jimma.gov.et>',
      to,
      subject,
      text,
      html: html || undefined,
      attachments,
    });
    console.log(`[SMTP Email Sent] To: ${to} | Subject: ${subject}`);
    return 'SENT';
  } catch (err) {
    console.error(`[SMTP Email Failed] To: ${to}:`, err.message);
    return 'FAILED';
  }
}

export async function sendSms({ to, text }) {
  if (!to) return 'SKIPPED';
  if (injectedSms) {
    try { await injectedSms({ to, text }); return 'SENT'; } catch { return 'FAILED'; }
  }
  const token = process.env.SMS_GATEWAY_TOKEN
    || process.env.SMS_TOKEN
    || process.env.MESSAGING_TOKEN
    || process.env.MESSAGE_TOKEN
    || process.env.SMS_API_KEY;

  const url = process.env.SMS_GATEWAY_URL;

  if (!url) {
    // never the message itself: an account message carries a temporary password, and logs are not for secrets
    console.log(`[SMS Skipped - SMS_GATEWAY_URL not set in .env] To: ${to} | ${String(text || '').length} characters${token ? ' (token is present)' : ''}`);
    return 'SKIPPED';
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ to, message: text.slice(0, 300) }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      // response wasn't JSON
    }

    const isError = !res.ok || (data && (data.acknowledge === 'error' || data.error || data.errors));
    if (isError) {
      const errMsg = (data && (data.response?.errors?.join(', ') || data.error || data.message || JSON.stringify(data))) || `HTTP ${res.status}`;
      console.error(`[SMS Gateway Failed] To: ${to} -> ${errMsg}`);
      return 'FAILED';
    }

    console.log(`[SMS Gateway ${res.status}] To: ${to} -> SENT`);
    return 'SENT';
  } catch (err) {
    console.error(`[SMS Delivery Failed] To: ${to}:`, err.message);
    return 'FAILED';
  }
}
