import mongoose from 'mongoose';

const exchangeSchema = new mongoose.Schema({
  prompt:    { type: String, required: true },   // user prompt
  response:  { type: String, required: true },   // AI response (plain text)
  tone:      { type: String, default: 'professional' },
  stopped:   { type: Boolean, default: false },      // true if the user stopped the reply early
  timestamp: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema(
  {
    title:     { type: String, default: 'New chat' },
    exchanges: [exchangeSchema],
  },
  { timestamps: true } // adds createdAt / updatedAt (used to sort the sidebar)
);

export default mongoose.model('Conversation', conversationSchema);
