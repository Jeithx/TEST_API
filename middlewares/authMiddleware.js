const config = require('../config/config');

/**
 * API Key doğrulama middleware'i
 */
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== config.api.key) {
    return res.status(401).json({
      success: false,
      message: 'Geçersiz API key'
    });
  }
  
  next();
}

module.exports = {
  validateApiKey
};