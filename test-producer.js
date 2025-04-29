const { v4: uuidv4 } = require('uuid');
const rabbitMQService = require('./services/rabbitMQ');
const config = require('./config/config');

// Rastgele bir örnek fotoğraf URL'si oluştur
function generateSamplePhotoUrl() {
  const sampleDomains = [
    'https://example.com',
    'https://sample-photos.com',
    'https://placeholder.com'
  ];
  
  const domain = sampleDomains[Math.floor(Math.random() * sampleDomains.length)];
  const id = Math.floor(Math.random() * 1000);
  
  return `${domain}/photo-${id}.jpg`;
}

// Test için özel URL belirt
function getTestPhotoUrl() {
  // Varsa yerel test görselini kullan, yoksa örnek URL oluştur
  return 'http://localhost:3000/test-images/human.png';
}

// Test amaçlı istek gönderme
async function sendTestRequest() {
  try {
    // RabbitMQ'ya bağlan
    await rabbitMQService.connect();
    
    // Test görselinin URL'si
    const photoUrl = getTestPhotoUrl();
    
    console.log(`Test isteği gönderiliyor - Fotoğraf URL: ${photoUrl}`);
    
    // İsteği oluştur
    const requestId = uuidv4();
    const message = {
      requestId,
      photoUrl,
      timestamp: new Date().toISOString()
    };
    
    // Kuyruğa gönder
    const channel = await rabbitMQService.getChannel();
    channel.sendToQueue(
      config.rabbitMQ.queueName,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json'
      }
    );
    
    console.log(`İstek başarıyla gönderildi - RequestID: ${requestId}`);
    
    // 2 saniye bekle ve bağlantıyı kapat
    setTimeout(async () => {
      await rabbitMQService.closeConnection();
      console.log('İşlem tamamlandı.');
      process.exit(0);
    }, 2000);
  } catch (error) {
    console.error('Test isteği gönderme hatası:', error.message);
    process.exit(1);
  }
}

// Test isteğini gönder
sendTestRequest();