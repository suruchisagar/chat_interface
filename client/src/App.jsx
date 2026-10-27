import { useEffect, useRef, useState } from 'react';
import './App.css';

const TONES = ['professional', 'casual', 'concise'];

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]); // { role: 'user' | 'ai', text }
  const [input, setInput] = useState('');
  const [tone, setTone] = useState('professional');
  const [streaming, setStreaming] = useState(false);

  const queue = useRef(''); // characters waiting to be "typed" on screen
  const bottomRef = useRef(null);

  // ---- Load the history sidebar ----
  const loadConversations = () =>
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {});
  useEffect(() => { loadConversations(); }, []);

  // ---- Typewriter: drain the queue a few characters at a time ----
  useEffect(() => {
    const id = setInterval(() => {
      if (!queue.current) return;
      const n = Math.max(1, Math.ceil(queue.current.length / 40)); // speed up if far behind
      const chunk = queue.current.slice(0, n);
      queue.current = queue.current.slice(n);
      setMessages((m) => {
        if (!m.length) return m;
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, text: last.text + chunk };
        return copy;
      });
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
      { role: 'ai', text: e.response },
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

  // ---- Send a prompt and read the streamed (SSE) reply ----
  const send = async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'ai', text: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, prompt, tone }),
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

          if (event === 'token') queue.current += data.text;
          if (event === 'done') { setActiveId(data.conversationId); loadConversations(); }
          if (event === 'error') queue.current += `\n\n⚠️ ${data.message}`;
        }
      }
    } catch (err) {
      queue.current += `⚠️ Could not get a reply: ${err.message}. Is the backend running?`;
    } finally {
      setStreaming(false);
    }
  };

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
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.text ||
                (streaming && i === messages.length - 1 ? <span className="typing">●●●</span> : '')}
            </div>
          ))}
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
          <button onClick={send} disabled={streaming || !input.trim()}>Send</button>
        </footer>
      </main>
    </div>
  );
}
