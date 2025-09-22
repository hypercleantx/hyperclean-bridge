const fetch = require('node-fetch');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam voice
const MODEL_ID = 'eleven_turbo_v2';

async function generateAudio(text) {
  if (!ELEVENLABS_API_KEY) {
    console.log('No ElevenLabs key, using fallback');
    return null;
  }
  
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });
    
    if (response.ok) {
      // In production, upload to S3/CDN and return URL
      // For now, return placeholder
      return `https://cdn.hypercleantx.com/audio/${Date.now()}.mp3`;
    }
  } catch (error) {
    console.error('TTS error:', error);
  }
  
  return null;
}

module.exports = { generateAudio };
