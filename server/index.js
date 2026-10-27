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
app.post('/api/chat', async (req, res) => {
  const { conversationId, prompt, tone = 'professional' } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

  let convo = conversationId ? await Conversation.findById(conversationId) : null;
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

  // Stop calling Gemini if the user closes the tab
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: `${BASE_SYSTEM}\n\n${TONES[tone] ?? TONES.professional}`, // <-- tone injected here
        abortSignal: abort.signal,
      },
    });

    let fullText = '';
    let blockReason;
    for await (const chunk of stream) {
      blockReason ??= chunk.promptFeedback?.blockReason;
      const text = chunk.text;
      if (text) {
        fullText += text;
        send('token', { text });
      }
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
    convo.exchanges.push({ prompt, response: fullText, tone, timestamp: new Date() });
    await convo.save();

    send('done', { conversationId: convo._id, title: convo.title });
  } catch (err) {
    if (abort.signal.aborted) return; // user left; nothing to send
    console.error(err);
    send('error', { message: err.message ?? 'Something went wrong' });
  }
  res.end();
});

// ---- Start ----
await mongoose.connect(process.env.MONGO_URI);
console.log('MongoDB connected');
app.listen(process.env.PORT || 5000, () =>
  console.log(`API running on http://localhost:${process.env.PORT || 5000}`)
);
