/*
 * HyperClean Bridge
 *
 * This service exposes a minimal HTTP API backed by Express along with a
 * WebSocket relay for real-time events. It acts as a backend gateway
 * between Twilio's messaging platform and Anthropic's Claude API to
 * automate customer support and sales interactions for the HyperClean
 * business. No frontend or UI code is included – this file is the
 * entirety of the application logic.
 */

const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { Client: TwilioClient } = require('twilio');
const { Anthropic } = require('@anthropic-ai/sdk');

// -----------------------------------------------------------------------------
// Environment validation
//
// Pull required secrets from process.env. If a variable is missing the server
// will refuse to start. This provides an early indication of configuration
// problems in deployment.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const PORT = process.env.PORT || 3000;

// Twilio credentials. These allow us to send and receive messages via the
// programmable messaging API. You must provision these values in your
// deployment environment.
const TWILIO_ACCOUNT_SID = requireEnv('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = requireEnv('TWILIO_AUTH_TOKEN');

// List of Twilio phone numbers owned by the business which will act as
// conversation endpoints. Configure as a comma-separated list in
// TWILIO_PHONE_NUMBERS (e.g. "+18327848994,+12144925798"). We expose them as
// an array for ease of processing.
const TWILIO_PHONE_NUMBERS = requireEnv('TWILIO_PHONE_NUMBERS')
  .split(',')
  .map(n => n.trim());

// Anthropic/Claude API key. This key authorises access to the Anthropic API.
const ANTHROPIC_API_KEY = requireEnv('ANTHROPIC_API_KEY');

// Model to use when querying Claude. You can override this via the
// ANTHROPIC_MODEL environment variable. See
// https://docs.anthropic.com/claude/docs/api-overview for available models.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229';

// Optional: ElevenLabs TTS API key if voice synthesis is desired. Only
// validated here – no direct dependency is included in this project.
if (process.env.ELEVENLABS_API_KEY) {
  // Validate format (simple length check). Real validation is performed in
  // downstream services.
  if (process.env.ELEVENLABS_API_KEY.length < 30) {
    throw new Error('ELEVENLABS_API_KEY appears invalid (too short)');
  }
}

// -----------------------------------------------------------------------------
// Initialise third party clients
//
const twilioClient = new TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// -----------------------------------------------------------------------------
// Express application setup
//
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply a small rate limit to all inbound requests. This helps mitigate abuse
// of the webhook endpoints. Limits are deliberately generous because Twilio
// routinely retries webhooks; adjust as necessary for production.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check endpoint. Render and other PaaS providers will ping this route
// to ensure the service is up. It returns a simple OK status.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// -----------------------------------------------------------------------------
// Helper functions
//
/**
 * Generate a response using Anthropic Claude based on an incoming message.
 *
 * @param {string} from - The phone number of the user sending the message.
 * @param {string} to - The Twilio number that received the message.
 * @param {string} body - The body of the incoming message.
 * @returns {Promise<string>} - A promise that resolves to the AI generated reply.
 */
async function generateClaudeResponse(from, to, body) {
  try {
    // Derive a high-level intent and build a tailored prompt. Business rules
    // from the provided patch files can be encoded in classifyIntent() and
    // buildPrompt() to alter the assistant’s behaviour without touching
    // this core logic.
    const intent = classifyIntent(body);
    const prompt = buildPrompt(intent, from, body);
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    const reply = msg?.choices?.[0]?.message?.content?.trim();
    return reply || 'Thank you for contacting HyperClean. We will get back to you shortly.';
  } catch (err) {
    console.error('Anthropic API error:', err);
    return 'Thank you for reaching out to HyperClean. We will get back to you soon.';
  }
}

/**
 * Determine a high-level intent from the incoming message body. This simple
 * classifier inspects keywords to decide whether the customer is looking to
 * schedule an appointment, request a quote, obtain support, or something else.
 * If no keywords match, it falls back to a general category. These intent
 * labels can be used to adjust downstream prompts or routing logic.
 *
 * @param {string} body - The incoming message body
 * @returns {string} - One of: 'appointment', 'sales', 'support', 'general'
 */
function classifyIntent(body) {
  const lower = String(body || '').toLowerCase();
  if (/\b(schedule|appointment|book|booking|cleaning date)\b/.test(lower)) return 'appointment';
  if (/\b(quote|estimate|price|rate)\b/.test(lower)) return 'sales';
  if (/\b(problem|issue|complaint|support|help)\b/.test(lower)) return 'support';
  return 'general';
}

/**
 * Generate a tailored prompt for Claude based on the detected intent. This
 * function allows us to customise the assistant's behaviour depending on
 * whether the conversation relates to booking, support, sales, or general
 * inquiries. Additional business rules and trigger logic can be added here
 * without impacting the core routing logic.
 *
 * @param {string} intent - The high-level intent label
 * @param {string} from - Caller phone number
 * @param {string} body - Raw message text
 * @returns {string} - Prompt to send to Claude
 */
function buildPrompt(intent, from, body) {
  let roleDescription = "HyperClean's AI assistant.";
  let instructions = '';
  switch (intent) {
    case 'appointment':
      instructions = 'The customer would like to schedule a cleaning appointment. Provide available dates and times, ask for their preferred appointment window, and confirm the booking.';
      break;
    case 'sales':
      instructions = 'The customer is asking about prices or quotes. Provide a brief overview of services and approximate rates, then invite them to schedule a consultation for a precise estimate.';
      break;
    case 'support':
      instructions = 'The customer has a problem or complaint. Acknowledge their issue empathetically, gather any necessary details, and assure them that a human team member will follow up if needed.';
      break;
    case 'general':
    default:
      instructions = 'Answer the customer’s question politely and helpfully. Offer to assist with scheduling or quotes if appropriate.';
  }
  return `You are ${roleDescription} A customer with number ${from} sent the following message:\n\n${body}\n\n${instructions} Respond in a friendly and professional tone.`;
}

/**
 * Send an SMS via Twilio. The `to` number must be E.164 formatted (e.g. +18327848994).
 *
 * @param {string} to - The recipient phone number.
 * @param {string} from - The Twilio phone number to send from.
 * @param {string} body - The message body.
 */
async function sendTwilioSms(to, from, body) {
  return twilioClient.messages.create({
    to,
    from,
    body,
  });
}

// -----------------------------------------------------------------------------
// Webhook handlers
//
/**
 * Twilio messaging webhook. This endpoint handles inbound SMS messages from
 * customers. When a message arrives we generate a response using Claude
 * and then send the reply back using Twilio. The incoming message is also
 * broadcast over the WebSocket server so any connected dashboards can
 * display it in real time.
 */
app.post('/twilio/inbound', async (req, res) => {
  const from = req.body.From;
  const to = req.body.To;
  const body = req.body.Body;
  if (!from || !to || !body) {
    return res.status(400).send('Invalid request');
  }
  console.log('Received inbound message', { from, to, body });
  // Immediately respond to Twilio so it doesn't retry. We'll process
  // the message asynchronously.
  res.status(200).send('<Response></Response>');
  try {
    // Generate AI response
    const reply = await generateClaudeResponse(from, to, body);
    // Choose the same Twilio number that received the message as the sender.
    await sendTwilioSms(from, to, reply);
    // Broadcast inbound and outbound events over WebSocket
    broadcast({ type: 'inbound', from, to, body });
    broadcast({ type: 'outbound', from: to, to: from, body: reply });
  } catch (err) {
    console.error('Error handling inbound message:', err);
  }
});

// -----------------------------------------------------------------------------
// WebSocket server
//
// Create a WebSocket server on the same HTTP server. This allows us to reuse
// the port on providers like Render that only expose a single port. Any
// connected client will receive JSON-encoded messages whenever a conversation
// event occurs.

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}

// Optional debug endpoint to send a message to a customer via HTTP
// Example: POST /send { "to": "+15551234567", "body": "Hello" }
app.post('/send', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ error: 'Both to and body are required' });
  }
  try {
    // Default from: first Twilio number configured
    const from = TWILIO_PHONE_NUMBERS[0];
    await sendTwilioSms(to, from, body);
    res.status(200).json({ status: 'sent' });
    broadcast({ type: 'outbound', from, to, body });
  } catch (err) {
    console.error('Error sending outbound message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Catch-all 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the HTTP and WebSocket server
server.listen(PORT, () => {
  console.log(`HyperClean bridge listening on port ${PORT}`);
});

// -----------------------------------------------------------------------------
// Global error handlers
//
// Catch unhandled promise rejections and uncaught exceptions to prevent the
// process from crashing. These handlers log the error and continue running.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
});
