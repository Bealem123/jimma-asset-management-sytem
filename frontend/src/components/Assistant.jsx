import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';
import NavIcon from './NavIcon.jsx';

const KEEP = 10; // earlier turns sent with a question, so a follow-up question has its context
const SUGGESTIONS = ['What is waiting for me?', 'How many assets are in poor or critical condition?', 'How do I register an asset?'];

/**
 * The AI assistant: a round button at the bottom right of every page, opening a small chat window.
 * It answers how-to questions and looks things up in the user's own area; it never changes anything.
 * Shown only when the server says the assistant is switched on.
 */
export default function Assistant() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { api.get('/assistant/status').then((s) => setEnabled(Boolean(s?.enabled))).catch(() => setEnabled(false)); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) return null;

  async function send(question) {
    const q = (question ?? text).trim();
    if (!q || busy) return;
    const history = [...messages, { role: 'user', content: q }];
    setMessages(history);
    setText('');
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/assistant/chat', { messages: history.slice(-KEEP) });
      setMessages([...history, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`assistant-fab${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)}
        aria-expanded={open} aria-controls="assistant-panel" aria-label={t('AI assistant')} title={t('AI assistant')}>
        <NavIcon name={open ? 'close' : 'chat'} />
      </button>
      {open && (
        <section id="assistant-panel" className="assistant-panel" role="dialog" aria-label={t('AI assistant')}>
          <header className="assistant-head">
            <div>
              <strong>{t('AI assistant')}</strong>
              <small>{t('Answers questions and looks things up in your area. It cannot change anything.')}</small>
            </div>
            <button type="button" className="assistant-icon" onClick={() => setOpen(false)} aria-label={t('Close')} title={t('Close')}><NavIcon name="close" /></button>
          </header>
          <div className="assistant-list" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>{t('Ask about your assets or how to do something in the system.')}</p>
                {SUGGESTIONS.map((s) => <button key={s} type="button" className="assistant-chip" onClick={() => send(t(s))}>{t(s)}</button>)}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role === 'user' ? 'from-me' : 'from-ai'}`}>{m.content}</div>
            ))}
            {busy && <div className="assistant-msg from-ai assistant-typing" aria-label={t('Thinking…')}><span /><span /><span /></div>}
            {error && <div className="assistant-error" role="alert">{t(error)}</div>}
          </div>
          <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={inputRef} rows={1} value={text} maxLength={2000} placeholder={t('Type your question…')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button type="submit" className="assistant-send" disabled={busy || !text.trim()} aria-label={t('Send')} title={t('Send')}><NavIcon name="send" /></button>
          </form>
          <p className="assistant-note">{t('AI answers can be wrong. Check the record before you act on it.')}</p>
        </section>
      )}
    </>
  );
}
