const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const rabbitMQService = require('./rabbitMQ');
const config = require('../config/config');

/**
 * RabbitMQ consumer başlatma
 */
async function startConsumer() {
  try {
    const channel = await rabbitMQService.getChannel();
    
    console.log(`"${config.rabbitMQ.queueName}" kuyruğundan mesajlar bekleniyor...`);
    
    channel.consume(config.rabbitMQ.queueName, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`Yeni istek alındı - RequestID: ${content.requestId}`);
          
          // İsteği işle
          await processPhotoRequest(content);
          
          // Mesajı kuyruktan sil
          channel.ack(msg);
        } catch (error) {
          console.error(`Mesaj işleme hatası:`, error.message);
          // İşlem başarısız olursa mesajı tekrar kuyruğa koy
          channel.nack(msg, false, true);
        }
      }
    });
  } catch (error) {
    console.error('Consumer başlatma hatası:', error.message);
    setTimeout(startConsumer, 5000);
  }
}

/**
 * Fotoğraf işleme isteğini işle
 * @param {Object} request - İşlenecek istek
 * @param {string} request.requestId - İstek ID
 * @param {string} request.photoUrl - Fotoğraf URL'si
 */
async function processPhotoRequest(request) {
  console.log(`İstek işleniyor - RequestID: ${request.requestId}, PhotoURL: ${request.photoUrl}`);
  
  // 5 saniye gecikme
  await new Promise(resolve => setTimeout(resolve, config.photos.delay));
  
  // Rastgele fotoğraf seç
  const randomPhoto = await selectRandomPhoto();
  console.log(`Rastgele fotoğraf seçildi: ${randomPhoto}`);
  
  // Sonucu API'ye gönder
  await sendResultToAPI(request.requestId, randomPhoto);
  
  console.log(`İstek başarıyla tamamlandı - RequestID: ${request.requestId}`);
}

/**
 * Rastgele bir fotoğraf seç
 * @returns {string} - Seçilen fotoğrafın tam dosya yolu
 */
async function selectRandomPhoto() {
  try {
    const photosDir = config.photos.directory;
    
    // Fotoğraf dizini yoksa oluştur
    await fs.ensureDir(photosDir);
    
    // Dizindeki tüm fotoğrafları al
    const files = await fs.readdir(photosDir);
    
    // Eğer fotoğraf yoksa hata fırlat
    if (files.length === 0) {
      throw new Error('Fotoğraf klasörü boş');
    }
    
    // Rastgele bir fotoğraf seç
    const randomIndex = Math.floor(Math.random() * files.length);
    const randomPhoto = files[randomIndex];
    
    return path.join(photosDir, randomPhoto);
  } catch (error) {
    console.error('Rastgele fotoğraf seçme hatası:', error.message);
    throw error;
  }
}

/**
 * Sonucu API'ye gönder
 * @param {string} requestId - İstek ID
 * @param {string} photoPath - Gönderilecek fotoğrafın dosya yolu
 */
async function sendResultToAPI(requestId, photoPath) {
  try {
    console.log(`API isteği için hazırlanıyor - RequestID: ${requestId}`);
    
    // Dosyanın var olduğunu ve okunabilir olduğunu kontrol et
    const fileExists = await fs.pathExists(photoPath);
    if (!fileExists) {
      throw new Error(`Dosya bulunamadı: ${photoPath}`);
    }
    
    console.log(`Dosya mevcut: ${photoPath}`);
    
    // Dosyayı buffer olarak oku
    const fileBuffer = await fs.readFile(photoPath);
    console.log(`Dosya okundu, boyut: ${fileBuffer.length} bytes`);
    
    // Dosya adını al
    const fileName = path.basename(photoPath);
    
    // FormData yerine multipart/form-data formatını manuel oluştur
    const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substr(2);
    let requestBody = [];
    
    // Dosya ekle
    requestBody.push(Buffer.from(`--${boundary}\r\n`));
    requestBody.push(Buffer.from(`Content-Disposition: form-data; name="File"; filename="${fileName}"\r\n`));
    requestBody.push(Buffer.from(`Content-Type: image/jpeg\r\n\r\n`));
    requestBody.push(fileBuffer);
    requestBody.push(Buffer.from(`\r\n`));
    
    // Veri tiplerini belirtilen değerlere göre ayarla
    // Multipart/form-data'da her şey string olarak gönderilir ancak
    // ASP.NET tarafında doğru veri tiplerine dönüştürülür
    const fields = {
      // number($float) tipleri - Ondalık formatla gönder
      'LegLength': 0.0,
      'ArmLength': 0.0,
      'ShoulderToCrotch': 0.0,
      'Shoulder': 0.0,
      'Chest': 0.0,
      'Waist': 0.0,
      'Hip': 0.0,
      'Thigh': 0.0,
      'FootSize': 40.0,
      'LowerChest': 0.0,
      
      // string tipi
      'Gender': 'Male',
      'Cup': 'A',
      
      // integer($int64) tipi
      'AppUserId': 400,
      
      // integer($int32) tipi
      'Height': 170,
      
      // boolean tipi - ASP.NET'in anlayacağı şekilde
      'IsSuccess': true,
      
      // string($date-time) tipleri - ISO formatı
      'CreateTime': new Date().toISOString()
      // UpdateTime null olabilir, boş bırakıyoruz
    };
    
    for (const [name, value] of Object.entries(fields)) {
      if (value !== null && value !== undefined) {
        requestBody.push(Buffer.from(`--${boundary}\r\n`));
        requestBody.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
        requestBody.push(Buffer.from(`${value}\r\n`));
      }
    }
    
    // Son boundary
    requestBody.push(Buffer.from(`--${boundary}--\r\n`));
    
    // Buffer'ları birleştir
    const requestData = Buffer.concat(requestBody);
    
    console.log(`API isteği gönderiliyor... RequestID: ${requestId}`);
    console.log(`Endpoint: ${config.api.responseEndpoint}`);
    
    // API'ye PUT isteği gönder
    const response = await axios.put(config.api.responseEndpoint, requestData, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'x-api-key': 'app.trendpiyasa.com.pazaryeri-converter',
        'Content-Length': requestData.length
      }
    });
    
    console.log(`API yanıtı - Status: ${response.status}`);
    console.log(`API yanıtı:`, response.data);
    return response.data;
  } catch (error) {
    console.error('API\'ye sonuç gönderme hatası:', error.message);
    if (error.response) {
      console.error(`Yanıt durumu: ${error.response.status}`);
      console.error(`Yanıt içeriği:`, error.response.data);
    } else if (error.request) {
      console.error('İstek yapıldı ama yanıt alınamadı');
    } else {
      console.error('İstek hatası:', error.message);
    }
    
    // Dosya ile ilgili daha fazla bilgi
    try {
      const stats = await fs.stat(photoPath);
      console.log(`Dosya bilgileri: ${JSON.stringify(stats)}`);
    } catch (statError) {
      console.error(`Dosya bilgileri alınamadı: ${statError.message}`);
    }
    
    throw error;
  }
}
module.exports = {
  startConsumer
};