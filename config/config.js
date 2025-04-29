

require('dotenv').config();
const path = require('path');

const config = {
  server: {
    port: process.env.PORT || 3000
  },
  
  api: {
    key: 'app.trendpiyasa.com.pazaryeri-converter',
    responseEndpoint: 'https://test.api.trendpiyasa.com/v1/api/userBodyInfo'
  },
  
  rabbitMQ: {
    hostName: process.env.RABBITMQ_HOSTNAME || '185.4.208.210',
    port: process.env.RABBITMQ_PORT || 5672,
    userName: process.env.RABBITMQ_USERNAME || 'test_user',
    password: process.env.RABBITMQ_PASSWORD || 'testTrendpiyasa',
    environment: process.env.RABBITMQ_ENVIRONMENT || 'test_env',
    queueName: 'UserBodyInfo'
  },
  photos: {
    directory: './photos',
    delay: 0, // ComfyUI kullanıldığında gecikme gerekmez
    count: 5
  },
  
  comfyUI: {
    enabled: true,                              // ComfyUI entegrasyonunu etkinleştirir/devre dışı bırakır
    serverUrl: 'http://127.0.0.1:8188',         // ComfyUI sunucu adresi
    workflowPath: path.join(__dirname, '../workflow.json'), // Workflow dosyası yolu
    tempDir: path.join(__dirname, '../temp_images'), // Geçici dosyalar için klasör
    timeout: 300000                            // İşlem zaman aşımı (ms) - 5 dakika
  }
};

module.exports = config;


