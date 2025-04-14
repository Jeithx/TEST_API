const express = require('express');
const config = require('./config/config');
const { validateApiKey } = require('./middlewares/authMiddleware');
const photoController = require('./controllers/photoController');
const consumerService = require('./services/consumer');

// Express uygulaması oluştur
const app = express();

// Middleware'ler
app.use(express.json());

// API endpoint'leri
app.post('/api/photo/process', validateApiKey, photoController.createPhotoProcessingRequest);

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', timestamp: new Date().toISOString() });
});

// Sunucuyu başlat
async function startServer() {
  try {
    // Örnek fotoğrafları oluştur
    await photoController.initializePhotos();
    
    // RabbitMQ consumer'ı başlat
    await consumerService.startConsumer();
    
    // Web sunucusunu başlat
    app.listen(config.server.port, () => {
      console.log(`Sunucu başlatıldı: http://localhost:${config.server.port}`);
    });
  } catch (error) {
    console.error('Sunucu başlatma hatası:', error.message);
    process.exit(1);
  }
}

// Uygulamayı başlat
startServer();