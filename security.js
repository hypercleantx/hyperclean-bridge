const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: 'Too many requests'
});

function validateTwilio(req, res, next) {
  // TODO: Implement Twilio signature validation
  // const signature = req.headers['x-twilio-signature'];
  // For now, basic check
  if (!req.body.CallSid) {
    return res.status(400).send('Invalid request');
  }
  next();
}

module.exports = { rateLimiter, validateTwilio };
