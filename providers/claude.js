const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const SYSTEM_PROMPT = `You are the HyperClean TX voice AI assistant. 
- Bilingual (English default, Spanish if detected/requested)
- Houston: $129 standard, $149 deep
- Dallas: $135 standard, $155 deep
- NO REFUNDS - only "We'll Make It Right" redo guarantee
- Keep responses under 50 words
- Be warm, professional, and helpful
- Gently upsell deep cleaning when appropriate`;

async function getCompletion(text, context) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 150,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: text
      }]
    });
    
    const responseText = response.content[0].text;
    const quote = extractQuote(responseText, context);
    
    return { text: responseText, quote };
  } catch (error) {
    console.error('Claude error:', error);
    return { text: "I'd be happy to help you book a cleaning. Let me text you our booking link." };
  }
}

async function streamCompletion(text, context) {
  // Same as getCompletion for now (streaming adds complexity)
  return getCompletion(text, context);
}

function extractQuote(text, context) {
  // Simple quote extraction logic
  if (text.includes('$149') || text.includes('deep clean')) {
    return { total: 149, service: { type: 'deep' } };
  } else if (text.includes('$129') || text.includes('standard clean')) {
    return { total: 129, service: { type: 'standard' } };
  }
  return null;
}

module.exports = { getCompletion, streamCompletion };
