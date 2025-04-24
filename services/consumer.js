const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const rabbitMQService = require('./rabbitMQ');
const comfyUIService = require('./comfyui-service');
const config = require('../config/config');

/**
 * RabbitMQ consumer başlatma
 */
async function startConsumer() {
  try {
    const channel = await rabbitMQService.getChannel();
    
    console.log(`"${config.rabbitMQ.queueName}" kuyruğundan mesajlar bekleniyor...`);
    
    // ComfyUI Servisini başlat
    if (config.comfyUI.enabled) {
      try {
        await comfyUIService.initialize();
        console.log('ComfyUI servisi başlatıldı');
      } catch (error) {
        console.error('ComfyUI servisi başlatılamadı:', error.message);
        console.log('ComfyUI olmadan devam ediliyor, rastgele fotoğraf seçilecek');
      }
    }
    
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
 * @param {string} request.photoUrl - Fotoğraf URL'si (giysi URL'si)
 */
async function processPhotoRequest(request) {
  console.log(`İstek işleniyor - RequestID: ${request.requestId}, PhotoURL: ${request.photoUrl}`);
  
  // 5 saniye gecikme
  await new Promise(resolve => setTimeout(resolve, config.photos.delay));
  
  try {
    let outputPhotoPath = null;
    
    // ComfyUI entegrasyonu etkinse ve çalışıyorsa
    if (config.comfyUI.enabled && config.comfyUI.useVirtualTryOn && comfyUIService.connected) {
      try {
        console.log('ComfyUI Virtual Try-On süreci başlatılıyor...');
        
        // Giysi görselini indir
        const garmentPath = await downloadImage(request.photoUrl, 'garment');
        console.log(`Giysi görseli indirildi: ${garmentPath}`);
        
        // İnsan görselini al (varsayılan olarak yapılandırmadaki yolu kullan)
        const humanImagePath = config.comfyUI.humanImagePath;
        
        // ComfyUI ile sanal giysi deneme işlemini gerçekleştir
        outputPhotoPath = await comfyUIService.processVirtualTryOn(humanImagePath, garmentPath);
        console.log(`Virtual Try-On işlemi tamamlandı: ${outputPhotoPath}`);
      } catch (error) {
        console.error('ComfyUI işlemi başarısız:', error.message);
        console.log('Rastgele fotoğraf seçme moduna geçiliyor...');
        outputPhotoPath = await selectRandomPhoto();
      }
    } else {
      // ComfyUI çalışmıyorsa rastgele fotoğraf seç
      outputPhotoPath = await selectRandomPhoto();
    }
    
    // Sonucu API'ye gönder
    await sendResultToAPI(request.requestId, outputPhotoPath);
    
    console.log(`İstek başarıyla tamamlandı - RequestID: ${request.requestId}`);
  } catch (error) {
    console.error(`İstek işleme hatası:`, error.message);
    throw error;
  }
}

/**
 * URL'den görsel indir
 * @param {string} url - İndirilecek görselin URL'si
 * @param {string} prefix - Dosya adı öneki
 * @returns {Promise<string>} - İndirilen görselin dosya yolu
 */
async function downloadImage(url, prefix = 'image') {
  try {
    // Geçici klasörü oluştur
    const tempDir = path.join(__dirname, '../temp');
    await fs.ensureDir(tempDir);
    
    // Dosya adını oluştur
    const filename = `${prefix}_${Date.now()}.jpg`;
    const filePath = path.join(tempDir, filename);
    
    // Görseli indir
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    await fs.writeFile(filePath, Buffer.from(response.data));
    
    console.log(`Görsel indirildi: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Görsel indirme hatası:', error.message);
    throw error;
  }
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
    const fields = {
      // number($float) tipleri - Ondalık formatla gönder
      'LegLength': '0.0',
      'ArmLength': '0.0',
      'ShoulderToCrotch': '0.0',
      'Shoulder': '0.0',
      'Chest': '0.0',
      'Waist': '0.0',
      'Hip': '0.0',
      'Thigh': '0.0',
      'FootSize': '40.0',
      'LowerChest': '0.0',
      
      // string tipi
      'Gender': 'Male',
      'Cup': 'A',
      
      // integer($int64) tipi
      'AppUserId': '1',
      
      // integer($int32) tipi
      'Height': '170',
      
      // boolean tipi - ASP.NET'in anlayacağı şekilde
      'IsSuccess': 'true',
      
      // string($date-time) tipleri - ISO formatı
      'CreateTime': new Date().toISOString()
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
    }
    throw error;
  }
}

module.exports = {
  startConsumer
};