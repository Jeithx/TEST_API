require('dotenv').config();

const config = {
  server: {
    port: process.env.PORT || 3000
  },
  api: {
    key: 'app.trendpiyasa.com.pazaryeri-converter',
    responseEndpoint: 'https://test.api.trendpiyasa.com/v1/api/userbodyinfo'
  },
  rabbitMQ: {
    hostName: process.env.RABBITMQ_HOSTNAME || '172.23.23.1',
    userName: process.env.RABBITMQ_USERNAME || 'test_user',
    password: process.env.RABBITMQ_PASSWORD || 'testTrendpiyasa',
    environment: process.env.RABBITMQ_ENVIRONMENT || 'test_env',
    queueName: 'photo_processing_queue'
  },
  photos: {
    directory: './photos',
    delay: 5000, // 5 saniye
    count: 5
  },
  comfyUI: {
    enabled: true,                        // ComfyUI entegrasyonunu etkinleştirir/devre dışı bırakır
    apiUrl: 'http://localhost:8188/api',  // ComfyUI API adresi
    outputDir: './output',                // Çıktı klasörü
    workflowPath: './workflow.json',      // Önceden hazırlanmış workflow dosyası
    useVirtualTryOn: true,                // Virtual Try-On özelliği kullanılsın mı?
    humanImagePath: './photos/human.jpg', // Varsayılan insan görüntüsü (RabbitMQ'dan gelmeyen durumlarda)
    garmentDir: './garments'              // Giysi görüntülerinin saklandığı klasör
  }
};

module.exports = config;