const express = require('express');
const WebSocket = require('ws');
const claude = require('./providers/claude');
const tts = require('./tts');
const security = require('./security');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(security.rateLimiter);

const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Twilio voice webhook
app.post('/voice/ai', security.validateTwilio, async (req, res) => {
  try {
    const { From, To, CallSid, SpeechResult } = req.body;
    
    // Get Claude response
    const context = { from: From, to: To, callSid: CallSid };
    const completion = await claude.getCompletion(SpeechResult || 'Hello', context);
    
    // Generate TTS
    const audioUrl = await tts.generateAudio(completion.text);
    
    // Return TwiML
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

// Outbound call TwiML
app.post('/outbound/twiml', (req, res) => {
  const data = JSON.parse(req.query.data || '{}');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello, this is HyperClean TX calling about partnership opportunities for ${data.company || 'your property'}.</Say>
  <Gather input="speech" timeout="3" action="${RENDER_URL}/voice/ai" method="POST">
    <Say>How can we help keep your residents happy with professional cleaning services?</Say>
  </Gather>
</Response>`;
  res.type('text/xml');
  res.send(twiml);
});

// Call status webhook
app.post('/outbound/status', (req, res) => {
  console.log('Call status:', req.body.CallStatus, req.body.CallSid);
  res.sendStatus(200);
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
      
      // Process with Claude
      const completion = await claude.streamCompletion(speech?.text || '', context);
      
      // Generate TTS if needed
      let audioUrl = null;
      if (completion.text) {
        audioUrl = await tts.generateAudio(completion.text);
      }
      
      // Send response
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
