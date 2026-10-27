import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

// ---------- Config ----------
const TONES = [
  { id: 'professional', label: 'Professional', emoji: '💼', hint: 'Polished and well structured' },
  { id: 'casual',       label: 'Casual',       emoji: '😊', hint: 'Friendly and relaxed' },
  { id: 'concise',      label: 'Concise',      emoji: '⚡', hint: 'Short and to the point' },
];
const toneById = Object.fromEntries(TONES.map((t) => [t.id, t]));

const SUGGESTIONS = [
  { title: 'Explain a concept', prompt: 'Explain how neural networks learn, in simple terms.' },
  { title: 'Write some code', prompt: 'Write a Python function that checks if a string is a palindrome.' },
  { title: 'Draft an email', prompt: 'Draft a polite email asking my manager for a deadline extension.' },
  { title: 'Get ideas', prompt: 'Give me 5 tips to stay productive while working from home.' },
];

// ---------- Icons ----------
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  sparkle: <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
};
function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// ---------- Small components ----------
function CopyButton({ text, label = 'Copy', className = 'action-btn' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; ignore */ }
  };
  return (
    <button className={className} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? 'Copied' : label}
    </button>
  );
}

function CodeBlock({ children }) {
  const codeEl = children?.props ?? {};
  const raw = Array.isArray(codeEl.children) ? codeEl.children.join('') : String(codeEl.children ?? '');
  const lang = /language-(\w+)/.exec(codeEl.className || '')?.[1] || 'code';
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{lang}</span>
        <CopyButton text={raw.replace(/\n$/, '')} label="Copy code" className="code-copy" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const markdownComponents = {
  pre: CodeBlock,
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
};

// Group sidebar chats into Today / Yesterday / Previous 7 days / Older
function groupByDate(list) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const groups = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] };
  for (const c of list) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= today) groups.Today.push(c);
    else if (t >= today - DAY) groups.Yesterday.push(c);
    else if (t >= today - 7 * DAY) groups['Previous 7 days'].push(c);
    else groups.Older.push(c);
  }
  return Object.entries(groups).filter(([, items]) => items.length);
}

// Theme: null = follow the system, otherwise 'light' | 'dark'
function readSavedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}

// ---------- App ----------
export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]); // { role: 'user' | 'ai', text, tone?, stopped? }
  const [input, setInput] = useState('');
  const [tone, setTone] = useState('professional');
  const [streaming, setStreaming] = useState(false);
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false); // phone layout only
  const [theme, setTheme] = useState(readSavedTheme);

  const queue = useRef('');       // characters waiting to be "typed" on screen
  const abortRef = useRef(null);  // lets the Stop button cancel the request
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // ---- Theme ----
  const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const isDark = theme ? theme === 'dark' : systemDark;
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem('theme', theme); } catch { /* storage blocked */ }
  }, [theme]);

  // ---- Load the history sidebar ----
  const loadConversations = () =>
    fetch('/api/conversations')
      .then((r) => (r.ok ? r.json() : []))
      .then(setConversations)
      .catch(() => {});
  useEffect(() => { loadConversations(); }, []);

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

  // ---- Auto-scroll and auto-grow input ----
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ---- Sidebar actions ----
  const openConversation = async (id) => {
    if (streaming) return;
    setSidebarOpen(false);
    const convo = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    setActiveId(id);
    setMessages(convo.exchanges.flatMap((e) => [
      { role: 'user', text: e.prompt },
      { role: 'ai', text: e.response, tone: e.tone, stopped: e.stopped },
    ]));
  };

  const newChat = () => {
    if (streaming) return;
    setSidebarOpen(false);
    setActiveId(null);
    setMessages([]);
    textareaRef.current?.focus();
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
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

  const send = (text = input) => {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'ai', text: '', tone }]);
    streamReply({ prompt });
  };

  // Re-answer the last prompt, using the currently selected tone
  const regenerate = () => {
    if (streaming || !activeId) return;
    setMessages((m) => [...m.slice(0, -1), { role: 'ai', text: '', tone }]);
    streamReply({ regenerate: true });
  };

  const stop = () => abortRef.current?.abort();

  // ---- Derived data ----
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title?.toLowerCase().includes(q)) : conversations;
    return groupByDate(filtered);
  }, [conversations, search]);

  const activeTitle = conversations.find((c) => c._id === activeId)?.title ?? 'New chat';
  const currentTone = toneById[tone];

  return (
    <div className="app">
      {/* ---------- Sidebar ---------- */}
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo"><Icon name="sparkle" size={18} /></div>
          <span className="brand-name">Vibe Chat</span>
        </div>

        <button className="new-chat" onClick={newChat}>
          <Icon name="plus" size={16} /> New chat
        </button>

        <div className="search">
          <Icon name="search" size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </div>

        <nav className="history">
          {groups.length === 0 && (
            <p className="history-empty">
              {search ? 'No chats match your search.' : 'Your conversations will appear here.'}
            </p>
          )}
          {groups.map(([label, items]) => (
            <div key={label} className="history-group">
              <h4>{label}</h4>
              <ul>
                {items.map((c) => (
                  <li
                    key={c._id}
                    className={c._id === activeId ? 'active' : ''}
                    onClick={() => openConversation(c._id)}
                  >
                    <Icon name="chat" size={15} />
                    <span className="history-title">{c.title}</span>
                    <button
                      className="history-delete"
                      title="Delete chat"
                      aria-label="Delete chat"
                      onClick={(e) => deleteConversation(c._id, e)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">Powered by Google Gemini</div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>

          <h1 className="topbar-title">{activeTitle}</h1>

          <div className="tone-control" role="radiogroup" aria-label="Response tone">
            {TONES.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={tone === t.id}
                title={t.hint}
                className={tone === t.id ? 'selected' : ''}
                onClick={() => setTone(t.id)}
              >
                <span className="tone-emoji">{t.emoji}</span>
                <span className="tone-label">{t.label}</span>
              </button>
            ))}
          </div>

          <button
            className="icon-btn"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            <Icon name={isDark ? 'sun' : 'moon'} />
          </button>
        </header>

        <section className="messages">
          <div className="messages-inner">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-logo"><Icon name="sparkle" size={28} /></div>
                <h2>How can I help you today?</h2>
                <p>
                  Replying in a <strong>{currentTone.emoji} {currentTone.label}</strong> tone.
                  Change it anytime from the top bar.
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.title} className="suggestion" onClick={() => send(s.prompt)}>
                      <span className="suggestion-title">{s.title}</span>
                      <span className="suggestion-text">{s.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => {
                const isLast = i === messages.length - 1;

                if (m.role === 'user') {
                  return (
                    <div key={i} className="msg msg-user">
                      <div className="user-bubble">{m.text}</div>
                    </div>
                  );
                }

                const t = toneById[m.tone];
                return (
                  <div key={i} className="msg msg-ai">
                    <div className="avatar"><Icon name="sparkle" size={16} /></div>
                    <div className="msg-body">
                      <div className="msg-meta">
                        <span className="msg-author">Assistant</span>
                        {t && <span className={`tone-badge tone-${t.id}`}>{t.emoji} {t.label}</span>}
                        {m.stopped && <span className="stopped-badge">Stopped</span>}
                      </div>

                      {m.text ? (
                        <div className="markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {m.text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        streaming && isLast && (
                          <div className="typing" aria-label="Assistant is typing">
                            <span /><span /><span />
                          </div>
                        )
                      )}

                      {m.text && !(streaming && isLast) && (
                        <div className="msg-actions">
                          <CopyButton text={m.text} />
                          {isLast && activeId && (
                            <button
                              className="action-btn"
                              onClick={regenerate}
                              title={`Write a new answer in the ${currentTone.label} tone`}
                            >
                              <Icon name="refresh" size={14} /> Regenerate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        <footer className="composer-wrap">
          <div className="composer">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder="Message Vibe Chat…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            {streaming ? (
              <button className="round-btn stop" onClick={stop} aria-label="Stop generating" title="Stop">
                <Icon name="stop" />
              </button>
            ) : (
              <button
                className="round-btn send"
                onClick={() => send()}
                disabled={!input.trim()}
                aria-label="Send message"
                title="Send"
              >
                <Icon name="send" />
              </button>
            )}
          </div>
          <p className="composer-hint">
            {currentTone.emoji} {currentTone.label} tone · Enter to send · Shift + Enter for a new line
          </p>
        </footer>
      </main>
    </div>
  );
}
