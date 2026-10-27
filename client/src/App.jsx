import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

const TONES = ['professional', 'casual', 'concise'];

// ---- Copy-to-clipboard button ----
function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; ignore */ }
  };
  return (
    <button className="copy-btn" onClick={copy}>{copied ? '✓ Copied' : label}</button>
  );
}

// ---- Code block with language label and its own copy button ----
function CodeBlock({ children }) {
  const codeEl = children?.props ?? {};
  const raw = Array.isArray(codeEl.children) ? codeEl.children.join('') : String(codeEl.children ?? '');
  const lang = /language-(\w+)/.exec(codeEl.className || '')?.[1] || 'code';
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{lang}</span>
        <CopyButton text={raw.replace(/\n$/, '')} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const markdownComponents = {
  pre: CodeBlock,
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
};

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]); // { role: 'user' | 'ai', text, stopped? }
  const [input, setInput] = useState('');
  const [tone, setTone] = useState('professional');
  const [streaming, setStreaming] = useState(false);

  const queue = useRef('');       // characters waiting to be "typed" on screen
  const abortRef = useRef(null);  // lets the Stop button cancel the request
  const bottomRef = useRef(null);

  // ---- Load the history sidebar ----
  const loadConversations = () =>
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {});
  useEffect(() => { loadConversations(); }, []);

  // Update the last message (the AI reply being written)
  const updateLast = (fn) =>
    setMessages((m) => {
      if (!m.length) return m;
      const copy = [...m];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  // ---- Typewriter: drain the queue a few characters at a time ----
  useEffect(() => {
    const id = setInterval(() => {
      if (!queue.current) return;
      const n = Math.max(1, Math.ceil(queue.current.length / 40)); // speed up if far behind
      const chunk = queue.current.slice(0, n);
      queue.current = queue.current.slice(n);
      updateLast((last) => ({ ...last, text: last.text + chunk }));
    }, 15);
    return () => clearInterval(id);
  }, []);

  // ---- Auto-scroll to the newest message ----
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ---- Open a past thread ----
  const openConversation = async (id) => {
    if (streaming) return;
    const convo = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    setActiveId(id);
    setMessages(convo.exchanges.flatMap((e) => [
      { role: 'user', text: e.prompt },
      { role: 'ai', text: e.response, stopped: e.stopped },
    ]));
  };

  const newChat = () => {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (id === activeId) newChat();
    loadConversations();
  };

  // ---- Call the backend and read the streamed (SSE) reply ----
  const streamReply = async ({ prompt, regenerate = false }) => {
    queue.current = '';
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, prompt, tone, regenerate }),
        signal: controller.signal,
      });

      if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error(`Server error (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop(); // keep any incomplete event for the next read

        for (const raw of events) {
          const event = raw.match(/^event: (.*)$/m)?.[1];
          const dataLine = raw.match(/^data: (.*)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);

          if (event === 'meta') setActiveId(data.conversationId);
          if (event === 'token') queue.current += data.text;
          if (event === 'error') queue.current += `\n\n⚠️ ${data.message}`;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        updateLast((last) => ({ ...last, stopped: true }));
      } else {
        queue.current += `⚠️ Could not get a reply: ${err.message}. Is the backend running?`;
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      loadConversations();
    }
  };

  const send = () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'ai', text: '' }]);
    streamReply({ prompt });
  };

  // Re-answer the last prompt, using the currently selected tone
  const regenerate = () => {
    if (streaming || !activeId) return;
    setMessages((m) => [...m.slice(0, -1), { role: 'ai', text: '' }]);
    streamReply({ regenerate: true });
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="app">
      {/* History sidebar */}
      <aside className="sidebar">
        <button className="new-chat" onClick={newChat}>+ New chat</button>
        <ul>
          {conversations.map((c) => (
            <li
              key={c._id}
              className={c._id === activeId ? 'active' : ''}
              onClick={() => openConversation(c._id)}
            >
              <span>{c.title}</span>
              <button title="Delete" onClick={(e) => deleteConversation(c._id, e)}>✕</button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat">
        {/* Tone toggle */}
        <header className="tone-toggle">
          <span className="label">Tone:</span>
          {TONES.map((t) => (
            <button key={t} className={tone === t ? 'selected' : ''} onClick={() => setTone(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </header>

        {/* Scrollable conversation */}
        <section className="messages">
          {messages.length === 0 && <p className="empty">Start a conversation…</p>}

          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;

            if (m.role === 'user') {
              return <div key={i} className="bubble user">{m.text}</div>;
            }

            return (
              <div key={i} className="ai-row">
                <div className="bubble ai">
                  {m.text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {m.text}
                    </ReactMarkdown>
                  ) : (
                    streaming && isLast && <span className="typing">●●●</span>
                  )}
                </div>

                {m.text && !(streaming && isLast) && (
                  <div className="msg-actions">
                    <CopyButton text={m.text} />
                    {isLast && activeId && (
                      <button onClick={regenerate} title="Write a new answer using the selected tone">
                        ↻ Regenerate
                      </button>
                    )}
                    {m.stopped && <span className="stopped-tag">Stopped</span>}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </section>

        {/* Input box */}
        <footer className="composer">
          <textarea
            value={input}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          {streaming ? (
            <button className="stop-btn" onClick={stop}>■ Stop</button>
          ) : (
            <button onClick={send} disabled={!input.trim()}>Send</button>
          )}
        </footer>
      </main>
    </div>
  );
}
