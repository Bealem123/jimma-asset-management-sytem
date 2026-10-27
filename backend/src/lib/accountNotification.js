import { db } from '../db.js';
import { ROLE_LABELS } from './constants.js';
import { sendEmail, sendSms } from './channels.js';

/**
 * When an account is created for ANY of the 8 account types in Jimma AMS:
 * 1. Super Administrator (SUPER_ADMIN)
 * 2. Mayor / Executive (EXECUTIVE)
 * 3. Kifle Ketema Administrator (KIFLE_ADMIN)
 * 4. Kebele Administrator (KEBELE_ADMIN)
 * 5. Sector Administrator (SECTOR_ADMIN)
 * 6. Internal Auditor (AUDITOR)
 * 7. Financial Officer (FINANCIAL_OFFICER)
 * 8. Inspector (INSPECTOR)
 *
 * This function dispatches both:
 * - SMTP Email (full credentials, role, portal link, security notice)
 * - SMS / Messaging (direct username, temporary password, sign-in link)
 * and logs an in-system notification record.
 */
export async function sendAccountCreationAlert({ user, plainPassword, areaName = '' }) {
  if (!user) return { emailStatus: 'SKIPPED', smsStatus: 'SKIPPED' };

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const loginUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/login` : 'http://localhost:5173/login';
  const systemName = 'Jimma City Smart Asset Management';

  // 1. Prepare SMS text (compact and clear)
  const smsText = `[Jimma City AMS] Hello ${user.full_name}, your ${roleLabel} account is created. Username: ${user.username}, Password: ${plainPassword}. Login: ${loginUrl}`;

  // 2. Prepare Email content (Rich HTML and Plain Text)
  const emailSubject = `[Jimma Assets] Your ${roleLabel} Account Details`;
  const emailText = `Hello ${user.full_name},

Welcome to the ${systemName}. Your official account has been successfully created with the following details:

- Full Name: ${user.full_name}
- Username: ${user.username}
- Role: ${roleLabel}
${areaName ? `- Assigned Area: ${areaName}\n` : ''}- Temporary Password: ${plainPassword}
- Sign In Portal: ${loginUrl}

Please sign in and change your password upon your first sign-in.

Jimma City Administration
Smart Asset Governance System`;

  const emailHtml = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e8e6; border-radius: 14px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #107a70 0%, #0e5a53 100%); padding: 24px; border-radius: 10px; text-align: center; color: #ffffff;">
        <h2 style="margin: 0; font-size: 22px; letter-spacing: 0.5px;">${systemName}</h2>
        <p style="margin: 6px 0 0; font-size: 14px; opacity: 0.92;">Official Account Credentials & Welcome</p>
      </div>

      <div style="padding: 24px 8px; color: #10201e; line-height: 1.6;">
        <p style="font-size: 16px;">Dear <strong>${user.full_name}</strong>,</p>
        <p>Your official account has been successfully created in the <strong>Jimma City Smart Asset Management System</strong>.</p>

        <div style="background-color: #f4f8f7; border-left: 4px solid #0e5a53; padding: 18px; margin: 22px 0; border-radius: 6px;">
          <p style="margin: 5px 0;"><strong>Account Type:</strong> <span style="color: #0e5a53; font-weight: 600;">${roleLabel}</span></p>
          <p style="margin: 5px 0;"><strong>Username:</strong> <code style="background: #e2ece9; padding: 3px 8px; border-radius: 4px; font-size: 14px;">${user.username}</code></p>
          <p style="margin: 5px 0;"><strong>Temporary Password:</strong> <code style="background: #e2ece9; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; color: #0e5a53;">${plainPassword}</code></p>
          ${areaName ? `<p style="margin: 5px 0;"><strong>Assigned Area:</strong> ${areaName}</p>` : ''}
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${loginUrl}" style="background: linear-gradient(135deg, #107a70 0%, #0e5a53 100%); color: #ffffff; padding: 13px 32px; text-decoration: none; border-radius: 999px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(14, 90, 83, 0.25);">
            Sign In to Asset Management System
          </a>
        </div>

        <p style="font-size: 13px; color: #6f7f7c; margin-top: 20px;">
          * <em>Security note:</em> You will be required to choose your own secure password upon your first sign-in. Please keep these credentials confidential.
        </p>
      </div>

      <div style="border-top: 1px solid #e0e8e6; padding-top: 16px; text-align: center; font-size: 12px; color: #8fa09d;">
        &copy; 2026 Jimma City Administration &middot; Smart Municipal Asset Governance
      </div>
    </div>
  `;

  // 3. Send Email (if user has email)
  let emailStatus = 'SKIPPED';
  if (user.email) {
    emailStatus = await sendEmail({
      to: user.email,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });
  }

  // 4. Send SMS (if user has phone)
  let smsStatus = 'SKIPPED';
  if (user.phone) {
    smsStatus = await sendSms({
      to: user.phone,
      text: smsText,
    });
  }

  console.log(`[Account Alert Dispatched] User: ${user.username} (${roleLabel}) | Email: ${emailStatus} | SMS: ${smsStatus}`);

  // 5. Store in-app notification
  try {
    await db('notifications').insert({
      user_id: user.id,
      type: 'ACCOUNT_CREATED',
      title: `Welcome to Jimma City Asset Management (${roleLabel})`,
      body: `Your account has been created with role ${roleLabel}. Please verify your profile and change your temporary password.`,
      email_status: emailStatus,
      sms_status: smsStatus,
      link: '/users',
    });
  } catch (err) {
    console.error('Failed to insert in-app welcome notification:', err.message);
  }

  return { emailStatus, smsStatus };
}
