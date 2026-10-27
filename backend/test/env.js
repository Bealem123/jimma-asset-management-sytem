// Must be the FIRST import of every test file: it points the app at the test database.
process.env.NODE_ENV = 'test';

// Tests never reach the outside world: no real SMS, e-mail or AI service, whatever backend/.env holds. dotenv does not
// override a variable that is already set, so these empty values win. A test that needs a channel injects a fake one
// (useTestChannels) or starts a local stand-in (the AI assistant test).
for (const name of [
  'SMS_GATEWAY_URL', 'SMS_GATEWAY_TOKEN', 'SMS_TOKEN', 'MESSAGING_TOKEN', 'MESSAGE_TOKEN',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD',
  'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL',
]) {
  process.env[name] = '';
}
