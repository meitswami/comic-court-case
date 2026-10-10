// Presence for live court sessions (who is reacting right now).
//
// Supabase Realtime presence is replaced by a small in-memory board: each
// participant posts their state every couple of seconds and gets back the
// state of everyone else on the same channel. Entries that stop refreshing
// are dropped. Nothing here is stored in the database.
//
// Note: state lives in this process, so run the API as a single instance
// (the default pm2 fork mode).

import express from 'express';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const STALE_MS = 12 * 1000;
const MAX_CHANNELS = 2000;
const MAX_STATE_BYTES = 2000;

// channel -> Map(key -> { state, seen, userId })
const channels = new Map();

function prune(now) {
  for (const [name, members] of channels) {
    for (const [key, member] of members) {
      if (now - member.seen > STALE_MS) members.delete(key);
    }
    if (members.size === 0) channels.delete(name);
  }
}

setInterval(() => prune(Date.now()), STALE_MS).unref();

router.post('/presence', authenticate, (req, res) => {
  const { channel, key, state, leave } = req.body || {};
  if (typeof channel !== 'string' || !channel || channel.length > 200) {
    return res.status(400).json({ error: 'Invalid channel' });
  }
  const now = Date.now();
  prune(now);

  let members = channels.get(channel);

  if (typeof key === 'string' && key && key.length <= 100) {
    if (leave) {
      if (members) {
        const member = members.get(key);
        if (member && member.userId === req.userId) members.delete(key);
      }
    } else if (state && typeof state === 'object') {
      if (JSON.stringify(state).length > MAX_STATE_BYTES) {
        return res.status(400).json({ error: 'State too large' });
      }
      if (!members) {
        if (channels.size >= MAX_CHANNELS) return res.status(503).json({ error: 'Busy' });
        members = new Map();
        channels.set(channel, members);
      }
      const current = members.get(key);
      // A key belongs to whoever claimed it first while it is live.
      if (!current || current.userId === req.userId) {
        members.set(key, { state, seen: now, userId: req.userId });
      }
    } else if (members && members.has(key)) {
      // Heartbeat without a state change.
      const member = members.get(key);
      if (member.userId === req.userId) member.seen = now;
    }
  }

  const out = {};
  for (const [memberKey, member] of channels.get(channel) || []) {
    out[memberKey] = member.state;
  }
  res.json({ state: out });
});

export default router;
