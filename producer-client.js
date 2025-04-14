const producerService = require('./services/producer');
const rabbitMQService = require('./services/rabbitMQ');

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

// Test amaçlı istek gönderme
async function sendTestRequest() {
  try {
    // RabbitMQ'ya bağlan
    await rabbitMQService.connect();
    
    // Örnek fotoğraf URL'si
    const photoUrl = generateSamplePhotoUrl();
    
    console.log(`Test isteği gönderiliyor - Fotoğraf URL: ${photoUrl}`);
    
    // İsteği gönder
    const requestId = await producerService.sendPhotoProcessingRequest(photoUrl);
    
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