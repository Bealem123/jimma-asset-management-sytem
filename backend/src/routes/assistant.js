import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { HttpError, parse } from '../middleware/errors.js';
import { logAudit } from '../lib/audit.js';
import { rateLimit } from '../lib/security.js';
import { aiSettings, answer } from '../lib/assistant.js';

const router = Router();
router.use(authenticate);

// Whether the assistant is switched on (the screen shows its button only then).
router.get('/status', (req, res) => res.json({ enabled: aiSettings().enabled }));

// Only the person's and the assistant's own turns are accepted; the instructions are always the server's.
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1, 'Type a question.').max(2000, 'Maximum 2000 characters.'),
  })).min(1).max(12),
}).refine((b) => b.messages.at(-1).role === 'user', { message: 'The last message must be your question.', path: ['messages'] });

const perPerson = Number(process.env.AI_RATE_PER_MINUTE || 10);

router.post('/chat', rateLimit({ windowMs: 60_000, max: perPerson, key: (req) => `ai:${req.user.id}`, message: 'You asked many questions in a short time. Please wait a minute.' }), async (req, res) => {
  if (!aiSettings().enabled) throw new HttpError(503, 'The AI assistant is not switched on for this system.');
  const { messages } = parse(chatSchema, req.body);
  const result = await answer(req.user, messages);
  // what was asked stays private: the audit trail notes that the assistant was used and which lookups it made
  await logAudit(null, req.user, {
    action: 'ASSISTANT_QUESTION', entity: 'assistant',
    summary: `Asked the AI assistant a question${result.tools.length ? ` (looked up: ${[...new Set(result.tools)].join(', ')})` : ''}`,
  });
  res.json({ answer: result.answer });
});

export default router;
