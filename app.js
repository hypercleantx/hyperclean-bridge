const express = require('express');
const WebSocket = require('ws');
const claude = require('./providers/claude');
const tts = require('./tts');
const security = require('./security');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(security.rateLimiter);

const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;

const CACHE_DIR = process.env.TTS_CACHE_DIR || '/tmp/tts_cache';
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
app.use('/audio', require('express').static(CACHE_DIR));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Twilio voice webhook
app.post('/voice/ai', security.validateTwilio, async (req, res) => {
  try {
    const { From, To, CallSid, SpeechResult } = req.body;
    const context = { from: From, to: To, callSid: CallSid };
    const completion = await claude.getCompletion(SpeechResult || 'Hello', context);
    const audioUrl = await tts.generateAudio(completion.text);
    const twiml = audioUrl
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${audioUrl}</Play></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${completion.text}</Say></Response>`;
    res.type('text/xml');
    res.send(twiml);
  } catch (error) {
    console.error('Voice AI error:', error);
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>I apologize, but I need to transfer you. One moment.</Say></Response>');
  }
});

// Outbound call TwiML (PM calling)
app.post('/outbound/twiml', (req, res) => {
  const { company = 'your property' } = req.query;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hi! This is Maria from HyperClean TX. We provide bilingual cleaning services that keep residents happy.</Say>
  <Pause length="1"/>
  <Say>We'd like to offer ${company} free placement in our resident portal, plus promotional flyers at no cost.</Say>
  <Gather numDigits="1" timeout="5" action="${RENDER_URL}/outbound/gather">
    <Say>Press 1 or say YES to receive our partnership details by email.</Say>
  </Gather>
  <Say>Thank you for your time. Have a great day!</Say>
</Response>`;
  res.type('text/xml').send(twiml);
});

// Call status webhook for outbound
app.post('/outbound/status', (req, res) => {
  const { CallSid, CallStatus, To } = req.body;
  console.log(`Call ${CallSid} to ${To}: ${CallStatus}`);
  res.sendStatus(200);
});

// Gather endpoint for outbound call
app.post('/outbound/gather', (req, res) => {
  const { Digits, SpeechResult } = req.body;
  if (Digits === '1' || /yes/i.test(SpeechResult)) {
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Perfect! We'll email you our partnership packet today. Thank you!</Say></Response>`);
  } else {
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>No problem. Feel free to call us at 832-784-8994 anytime. Goodbye!</Say></Response>`);
  }
});

// WebSocket for Conversation Relay
const server = app.listen(PORT, () => {
  console.log(`HyperClean Bridge running on ${PORT}`);
});

const wss = new WebSocket.Server({ server, path: '/ws/relay' });

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      const { speech, context } = message;
      const completion = await claude.streamCompletion(speech?.text || '', context);
      let audioUrl = null;
      if (completion.text) {
        audioUrl = await tts.generateAudio(completion.text);
      }
      ws.send(JSON.stringify({
        text: completion.text,
        audioUrl,
        quote: completion.quote
      }));
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ error: 'Processing failed' }));
    }
  });
});
