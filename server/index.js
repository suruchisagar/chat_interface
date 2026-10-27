import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import Conversation from './models/Conversation.js';

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// ---- The Vibe Check: tone -> system instruction modifier ----
const BASE_SYSTEM = 'You are a helpful AI assistant inside a chat application.';
const TONES = {
  professional: 'Tone: professional. Use polished, precise language and clear structure. Avoid slang.',
  casual:       'Tone: casual. Be friendly and relaxed, like chatting with a friend. Light humor is fine.',
  concise:      'Tone: concise. Give the shortest complete answer possible: a few sentences or bullets, no filler.',
};

// ---- History sidebar endpoints ----
app.get('/api/conversations', async (_req, res) => {
  const list = await Conversation.find({}, 'title updatedAt').sort({ updatedAt: -1 });
  res.json(list);
});

app.get('/api/conversations/:id', async (req, res) => {
  const convo = await Conversation.findById(req.params.id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  res.json(convo);
});

app.delete('/api/conversations/:id', async (req, res) => {
  await Conversation.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---- Chat endpoint with streaming (SSE) ----
// Body: { conversationId?, prompt, tone, regenerate? }
// regenerate: true re-answers the last prompt and replaces its saved reply.
app.post('/api/chat', async (req, res) => {
  const { conversationId, tone = 'professional', regenerate = false } = req.body;
  let prompt = req.body.prompt;

  let convo = conversationId ? await Conversation.findById(conversationId) : null;

  if (regenerate) {
    const last = convo?.exchanges.at(-1);
    if (!last) return res.status(400).json({ error: 'Nothing to regenerate' });
    prompt = last.prompt;
    convo.exchanges.pop(); // removed in memory only; the new reply replaces it when saved
  }

  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  if (!convo) convo = new Conversation({ title: prompt.slice(0, 40) });

  // Rebuild past turns so Gemini has context ("model" is Gemini's name for the AI role)
  const history = convo.exchanges.flatMap((e) => [
    { role: 'user', parts: [{ text: e.prompt }] },
    { role: 'model', parts: [{ text: e.response }] },
  ]);

  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Stop calling Gemini if the user presses Stop or closes the tab
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  // Tell the browser the conversation id right away, so a stopped reply still belongs to this chat
  send('meta', { conversationId: convo._id });

  let fullText = '';
  let blockReason;

  const saveExchange = async (stopped) => {
    convo.exchanges.push({ prompt, response: fullText, tone, stopped, timestamp: new Date() });
    await convo.save();
  };

  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: `${BASE_SYSTEM}\n\n${TONES[tone] ?? TONES.professional}`, // <-- tone injected here
        abortSignal: abort.signal,
      },
    });

    for await (const chunk of stream) {
      if (abort.signal.aborted) break;
      blockReason ??= chunk.promptFeedback?.blockReason;
      const text = chunk.text;
      if (text) {
        fullText += text;
        send('token', { text });
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error(err);
      send('error', { message: err.message ?? 'Something went wrong' });
      return res.end();
    }
  }

  try {
    // User pressed Stop: keep whatever was written so far
    if (abort.signal.aborted) {
      if (fullText) await saveExchange(true);
      return;
    }

    if (!fullText) {
      send('error', {
        message: blockReason
          ? `The AI blocked this request (${blockReason}).`
          : 'The AI returned an empty response.',
      });
      return res.end();
    }

    // Persist: timestamp + prompt + response
    await saveExchange(false);
    send('done', { conversationId: convo._id, title: convo.title });
  } catch (err) {
    console.error(err);
    send('error', { message: 'Reply was generated but could not be saved.' });
  }
  res.end();
});

// ---- Start ----
await mongoose.connect(process.env.MONGO_URI);
console.log('MongoDB connected');
app.listen(process.env.PORT || 5000, () =>
  console.log(`API running on http://localhost:${process.env.PORT || 5000}`)
);
