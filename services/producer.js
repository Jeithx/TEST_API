const { v4: uuidv4 } = require('uuid');
const rabbitMQService = require('./rabbitMQ');
const config = require('../config/config');

/**
 * Fotoğraf işleme kuyruğuna yeni bir istek gönderir
 * @param {string} photoUrl - İşlenecek fotoğrafın URL'si
 * @returns {string} - İsteğin benzersiz ID'si
 */
async function sendPhotoProcessingRequest(photoUrl) {
  try {
    if (!photoUrl) {
      throw new Error('Fotoğraf URL\'si gereklidir');
    }

    const channel = await rabbitMQService.getChannel();
    const requestId = uuidv4();
    
    const message = {
      requestId,
      photoUrl,
      timestamp: new Date().toISOString()
    };

    channel.sendToQueue(
      config.rabbitMQ.queueName,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json'
      }
    );

    console.log(`Fotoğraf işleme talebi gönderildi - RequestID: ${requestId}`);
    return requestId;
  } catch (error) {
    console.error('Fotoğraf işleme talebi gönderilemedi:', error.message);
    throw error;
  }
}

module.exports = {
  sendPhotoProcessingRequest
};