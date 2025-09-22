const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.TTS_CACHE_DIR || '/tmp/tts_cache';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

async function generateAudio(text, options = {}) {
  if (!ELEVENLABS_API_KEY) return null;
  
  const textHash = crypto.createHash('md5').update(text).digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${textHash}.mp3`);
  
  // Check cache
  if (fs.existsSync(cacheFile) && !options.skipCache) {
    return `${process.env.RENDER_URL}/audio/${textHash}.mp3`;
  }
  
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    
    if (response.ok) {
      const buffer = await response.buffer();
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, buffer);
      return `${process.env.RENDER_URL}/audio/${textHash}.mp3`;
    }
  } catch (err) {
    console.error('TTS error:', err.message);
  }
  return null;
}

module.exports = { generateAudio };
