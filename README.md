# Intelligent Chat App

A real-time AI chat app with streaming replies, saved conversation history and a tone toggle. It's built with React, Express, MongoDB and the Google Gemini API.

## Features

- **Chat interface:** a scrollable conversation with separate bubbles for the user (right) and the AI (left).
- **Streaming view:** AI replies appear character by character as they're generated.
- **History sidebar:** past conversations are listed, can be reopened, and can be deleted.
- **Persistence:** every exchange is saved to MongoDB with its timestamp, user prompt, AI response and tone.
- **Tone toggle ("Vibe Check"):** choose **Professional**, **Casual** or **Concise**. The backend adds the choice to the Gemini request as a system instruction, so the style changes from the next reply.

### Extra features

1. **Stop and Regenerate**
   - **■ Stop** cancels a reply while it's streaming. The backend also stops the Gemini request, so no further tokens are used. The text written so far is kept, saved, and labeled **Stopped**.
   - **↻ Regenerate** writes a new answer to the last prompt and replaces the old one in the database. It uses the tone selected now, so you can turn a long Professional answer into a Concise one without retyping the question.

2. **Markdown formatting with copy buttons**
   - AI replies are shown as formatted Markdown: headings, bold text, lists, tables, links and inline code. Raw `**` and `###` symbols don't appear.
   - Code blocks show their language and have a **Copy code** button.
   - Every AI reply has a **Copy** button.

## Tech stack

| Layer    | Technology                                  |
|----------|---------------------------------------------|
| Frontend | React 19, Vite, react-markdown + remark-gfm |
| Backend  | Node.js, Express 5                          |
| Database | MongoDB with Mongoose                       |
| AI       | Google Gemini API (`@google/genai` SDK)     |
| Realtime | Server-Sent Events (SSE)                    |

## Project structure

```
chat_app_quantiphi/
├── client/                  # React frontend
│   ├── src/
│   │   ├── App.jsx          # Chat UI, sidebar, tone toggle, streaming logic
│   │   ├── App.css          # Chat styles
│   │   ├── index.css        # Global styles
│   │   └── main.jsx         # React entry point
│   └── vite.config.js       # Dev proxy: /api -> http://localhost:5000
└── server/                  # Express backend
    ├── models/
    │   └── Conversation.js  # MongoDB schema
    ├── index.js             # API routes, Gemini streaming, tone handling
    └── .env                 # Secrets and config (not committed)
```

## How it works

```
Browser (React)  ──POST /api/chat──▶  Express server  ──stream──▶  Gemini API
      ▲                                     │
      └──── SSE events: token / done ◀─────┤
                                           ▼
                                        MongoDB (saves the exchange)
```

1. The user types a message and picks a tone.
2. The frontend sends `{ prompt, tone, conversationId }` to `POST /api/chat`.
3. The server loads earlier messages from MongoDB so Gemini has context. It then calls Gemini with the tone as a `systemInstruction`.
4. Each chunk of text from Gemini goes straight to the browser as an SSE `token` event.
5. The frontend queues the chunks and types them out a few characters at a time, which gives the typewriter effect.
6. When the reply finishes, the server saves the exchange to MongoDB and sends a `done` event. The sidebar then refreshes.

### Tone toggle

Each tone maps to an instruction in [server/index.js](server/index.js) that is added to the system prompt:

| Tone         | Instruction given to the AI                                                        |
|--------------|------------------------------------------------------------------------------------|
| Professional | Polished, precise language and clear structure. No slang.                          |
| Casual       | Friendly and relaxed, like chatting with a friend. Light humor is fine.            |
| Concise      | The shortest complete answer: a few sentences or bullets, no filler.               |

The tone is sent with every message. Switching tones in the middle of a conversation changes the style from the next reply onward.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- MongoDB, either a local [MongoDB Community Server](https://www.mongodb.com/try/download/community) or a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

### 1. Install dependencies

```bash
cd server
npm install

cd ../client
npm install
```

### 2. Configure environment variables

Create `server/.env` with:

```env
MONGO_URI=mongodb://127.0.0.1:27017/chat_app
PORT=5000
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.8-flash
```

| Variable         | Description                                                                 |
|------------------|-----------------------------------------------------------------------------|
| `MONGO_URI`      | MongoDB connection string. For Atlas, use the `mongodb+srv://...` string.   |
| `PORT`           | Backend port. The default is `5000`.                                        |
| `GEMINI_API_KEY` | Your key from Google AI Studio.                                             |
| `GEMINI_MODEL`   | Gemini model to use. If not set, the server uses `gemini-flash-latest`.     |

> Never commit `.env` or put the API key in frontend code.

### 3. Run the app

Start the backend in one terminal:

```bash
cd server
npm run dev
```

Wait for `MongoDB connected` and `API running on http://localhost:5000`.

Start the frontend in a second terminal:

```bash
cd client
npm run dev
```

Open **http://localhost:5173**.

## API reference

| Method | Endpoint                  | Description                                                     |
|--------|---------------------------|-----------------------------------------------------------------|
| GET    | `/api/conversations`      | List conversations (title and last update), newest first.       |
| GET    | `/api/conversations/:id`  | Get one conversation with all its exchanges.                    |
| DELETE | `/api/conversations/:id`  | Delete a conversation.                                          |
| POST   | `/api/chat`               | Send a message. The reply streams back as Server-Sent Events.   |

**`POST /api/chat` request body:**

```json
{
  "conversationId": "optional; leave out to start a new chat",
  "prompt": "Explain recursion",
  "tone": "professional | casual | concise",
  "regenerate": false
}
```

Set `"regenerate": true` and leave out `prompt` to re-answer the last prompt in `conversationId`. The new reply replaces the old one. If the client disconnects (the Stop button), the server cancels the Gemini request and saves the partial reply with `stopped: true`.

**Streamed events:**

| Event   | Data                               | Meaning                               |
|---------|------------------------------------|---------------------------------------|
| `meta`  | `{ "conversationId" }`             | Sent first, with the conversation id. |
| `token` | `{ "text": "..." }`                | The next chunk of the AI reply.       |
| `done`  | `{ "conversationId", "title" }`    | The reply is finished and saved.      |
| `error` | `{ "message": "..." }`             | Something went wrong.                 |

## Data model

Each conversation is saved in the `conversations` collection:

```json
{
  "_id": "...",
  "title": "Explain recursion",
  "exchanges": [
    {
      "prompt": "Explain recursion",
      "response": "Recursion is when a function calls itself...",
      "tone": "professional",
      "stopped": false,
      "timestamp": "2026-10-27T10:15:00.000Z"
    }
  ],
  "createdAt": "2026-10-27T10:15:00.000Z",
  "updatedAt": "2026-10-27T10:15:04.000Z"
}
```

## Troubleshooting

| Problem                                         | Cause and fix                                                                                       |
|-------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| AI bubble is empty or shows "Could not get a reply" | The backend isn't running. Check the server terminal. It usually means MongoDB isn't reachable. |
| `ECONNREFUSED 127.0.0.1:27017`                  | Local MongoDB isn't running. Start the MongoDB service, or use Atlas.                               |
| Atlas connection times out                      | Your IP isn't allowed. Add it under **Network Access** in Atlas.                                    |
| `API key not valid`                             | Check `GEMINI_API_KEY` in `server/.env`, then restart the server.                                   |
| `model ... is no longer available to new users` | Set `GEMINI_MODEL` to a newer model, such as `gemini-flash-latest`, then restart the server.        |
| Changes to `.env` have no effect                | The server reads `.env` only at startup. Restart it.                                                |
