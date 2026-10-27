import './env.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { useTestChannels } from '../src/lib/channels.js';
import { sendAccountCreationAlert } from '../src/lib/accountNotification.js';
import { SYSTEM_ROLES, ROLE_LABELS } from '../src/lib/constants.js';

describe('Account creation messaging (Email & SMS) for all 8 account types', () => {
  const sentMail = [];
  const sentSms = [];

  test('dispatches both SMTP email and SMS with credentials for all 8 account types', async () => {
    useTestChannels({
      mail: {
        sendMail: async (opts) => {
          sentMail.push(opts);
          return { messageId: 'test-mail-id' };
        },
      },
      sms: async (opts) => {
        sentSms.push(opts);
        return { ok: true };
      },
    });

    try {
      assert.equal(SYSTEM_ROLES.length, 8, 'There must be exactly 8 system roles');

      for (const role of SYSTEM_ROLES) {
        const fakeUser = {
          id: 999000 + Math.floor(Math.random() * 1000),
          username: `user_${role.toLowerCase()}`,
          full_name: `Test ${ROLE_LABELS[role]}`,
          role,
          email: `${role.toLowerCase()}@jimma.gov.et`,
          phone: '+251911223344',
        };
        const tempPassword = `Pass@${role}123!`;

        const result = await sendAccountCreationAlert({
          user: fakeUser,
          plainPassword: tempPassword,
          areaName: 'Jimma Central',
        });

        assert.equal(result.emailStatus, 'SENT', `Email should be sent for ${role}`);
        assert.equal(result.smsStatus, 'SENT', `SMS should be sent for ${role}`);

        // Verify sent email
        const mail = sentMail[sentMail.length - 1];
        assert.equal(mail.to, fakeUser.email);
        assert.match(mail.subject, new RegExp(ROLE_LABELS[role]));
        assert.match(mail.text, new RegExp(fakeUser.username));
        assert.match(mail.text, new RegExp(tempPassword));

        // Verify sent SMS
        const sms = sentSms[sentSms.length - 1];
        assert.equal(sms.to, fakeUser.phone);
        assert.match(sms.text, new RegExp(fakeUser.username));
        assert.match(sms.text, new RegExp(tempPassword));
        assert.match(sms.text, new RegExp(ROLE_LABELS[role]));
      }

      assert.equal(sentMail.length, 8, 'All 8 roles should have received an email');
      assert.equal(sentSms.length, 8, 'All 8 roles should have received an SMS');
    } finally {
      useTestChannels(); // reset
    }
  });
});
