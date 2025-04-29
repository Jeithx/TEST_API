const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const config = require('./config/config');
const consumerService = require('./services/consumer');
const comfyUIService = require('./services/comfyui-service');

// Express uygulaması oluştur ama API amaçlı değil, sadece sağlık kontrolü için
const app = express();

// Middleware'ler sadece basic işlemler için
app.use(express.json());

// Temp klasörlerini oluştur
fs.ensureDirSync(config.comfyUI.tempDir);
fs.ensureDirSync('./processed_images'); // İşlenmiş görseller için

// Tüm API endpoint'lerini kaldır
// Sadece sağlık kontrolü endpoint'i kalsın
app.get('/health', (req, res) => {
  const comfyUIStatus = comfyUIService.connected ? 'connected' : 'disconnected';
  
  res.status(200).json({ 
    status: 'up', 
    timestamp: new Date().toISOString(),
    services: {
      comfyUI: comfyUIStatus,
      rabbitMQ: 'listening' // Sadece dinliyoruz artık
    }
  });
});

// Sunucuyu başlat
async function startServer() {
  try {
    console.log('Consumer servisi başlatılıyor...');
    
    // ComfyUI bağlantısını başlat
    try {
      await comfyUIService.connect();
      console.log('ComfyUI bağlantısı başarılı');
    } catch (error) {
      console.error('ComfyUI bağlantı hatası:', error.message);
      console.warn('ComfyUI bağlantısı olmadan devam ediliyor');
    }
    
    // Workflow dosyasını kontrol et
    const workflowPath = config.comfyUI.workflowPath;
    if (!fs.existsSync(workflowPath)) {
      console.error(`Workflow dosyası bulunamadı: ${workflowPath}`);
      const workflowContent = fs.readFileSync(path.join(__dirname, 'workflow-backup.json'), 'utf-8');
      fs.writeFileSync(workflowPath, workflowContent);
      console.log('Yedek workflow dosyası oluşturuldu');
    }
    
    // RabbitMQ consumer'ı başlat - ana işlev bu
    try {
      // Bu kısım değişiyor - RabbitMQ bağlantı hatası olsa bile devam edebiliriz
      console.log('RabbitMQ consumer başlatılıyor...');
      consumerService.startConsumer().catch(err => {
        console.error('RabbitMQ consumer hatası:', err.message);
        console.log('Consumer servis hatası olsa bile sunucu çalışmaya devam ediyor.');
      });
      console.log('RabbitMQ consumer başlatma isteği gönderildi');
    } catch (error) {
      console.error('RabbitMQ consumer başlatma hatası:', error.message);
      console.log('Consumer servis hatası olsa bile sunucu çalışmaya devam ediyor.');
    }
    
    // Web sunucusunu başlat - sadece sağlık kontrolü için
    app.listen(config.server.port, () => {
      console.log(`Sağlık kontrolü sunucusu başlatıldı: http://localhost:${config.server.port}/health`);
      console.log('Sistem hazır, RabbitMQ bağlantısı kurulduğunda mesajlar işlenecek...');
    });
  } catch (error) {
    console.error('Sunucu başlatma hatası:', error.message);
    process.exit(1);
  }
}

// Uygulamayı başlat
startServer();

// Temizlik işlevi aynı kalıyor

// Temizlik işlevi
process.on('SIGINT', async () => {
  console.log('Uygulama kapatılıyor...');
  
  // Geçici dosyaları temizle
  try {
    await comfyUIService.cleanup();
  } catch (error) {
    console.error('Temizlik hatası:', error.message);
  }
  
  process.exit(0);
});