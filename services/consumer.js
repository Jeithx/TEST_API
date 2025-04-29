const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const rabbitMQService = require('./rabbitMQ');
const config = require('../config/config');
const comfyUIService = require('./comfyui-service');

/**
 * RabbitMQ consumer başlatma
 */
async function startConsumer() {
  try {
    const channel = await rabbitMQService.getChannel();
    
    console.log(`"${config.rabbitMQ.queueName}" kuyruğundan mesajlar bekleniyor...`);
    
    // ComfyUI WebSocket bağlantısını kur
    await comfyUIService.connect();
    
    channel.consume(config.rabbitMQ.queueName, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`Yeni mesaj alındı - MessageID: ${content.messageId}`);
          
          // MassTransit formatı için mesaj içeriğini kontrol et
          if (!content.message) {
            throw new Error('Geçersiz mesaj formatı: message özelliği bulunamadı');
          }
          
          const userData = content.message;
          console.log(`İşlenecek kullanıcı - AppUserId: ${userData.appUserId}`);
          
          // İsteği işle - front image veya kullanılabilir herhangi bir görsel
          let imageUrl = userData.frontImage || userData.sideImage || userData.faceImage;
          if (!imageUrl) {
            throw new Error('İşlenecek görsel bulunamadı');
          }
          
          // Benzersiz istek ID'si oluştur (message.id geçersiz olabilir)
          const requestId = userData.id > 0 ? userData.id.toString() : content.messageId;
          
          // Veriyi işleme uygun formata çevir
          const request = {
            requestId: requestId,
            photoUrl: imageUrl,
            appUserId: userData.appUserId,
            gender: userData.gender,
            height: userData.height || 170,
            timestamp: userData.createTime,
            // Diğer vücut ölçüleri
            shoulder: userData.shoulder || 0.0,
            chest: userData.chest || 0.0,
            waist: userData.waist || 0.0,
            hip: userData.hip || 0.0,
            thigh: userData.thigh || 0.0,
            armLength: userData.armLength || 0.0,
            legLength: userData.legLength || 0.0,
            shoulderToCrotch: userData.shoulderToCrotch || 0.0,
            cup: userData.cup || 'A',
            footSize: userData.footSize || 40.0,
            lowerChest: userData.lowerChest || 0.0
          };
          
          // İsteği işle
          await processPhotoRequest(request);
          
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
 */
async function processPhotoRequest(request) {
  console.log(`İstek işleniyor - ID: ${request.requestId}, PhotoURL: ${request.photoUrl}`);
  
  try {
    // 1. Gelen fotoğraf URL'sinden görseli indir
    const humanImagePath = await downloadImage(request.photoUrl, request.requestId);
    console.log(`İnsan görseli indirildi: ${humanImagePath}`);
    
    // 2. ComfyUI işleme kuyruğuna ekle ve sonucu bekle
    console.log(`ComfyUI kuyruğuna gönderiliyor...`);
    const result = await comfyUIService.queueRequest(request.requestId, humanImagePath);
    console.log(`ComfyUI işlemi tamamlandı: ${result.imagePath}`);
    
    // 3. Sonucu API'ye gönder
    const apiResponse = await sendResultToAPI(request, result.imagePath);
    console.log(`API yanıtı alındı: ${JSON.stringify(apiResponse)}`);
    
    return apiResponse;
  } catch (error) {
    console.error(`İstek işleme hatası:`, error.message);
    throw error;
  }
}

/**
 * URL'den görüntü indir ve temp klasörüne kaydet
 * @param {string} imageUrl - İndirilecek görüntü URL'si
 * @param {string} requestId - İstek ID'si
 * @returns {Promise<string>} - Kaydedilen dosya yolu
 */
async function downloadImage(imageUrl, requestId) {
  try {
    // Temp klasörünü kontrol et
    const tempDir = path.join(__dirname, '../temp_images');
    await fs.ensureDir(tempDir);
    
    // Dosya adını oluştur
    const fileExt = imageUrl.includes('.jpg') ? '.jpg' : '.png';
    const fileName = `human_${requestId}${fileExt}`;
    const filePath = path.join(tempDir, fileName);
    
    // Görüntüyü indir
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    await fs.writeFile(filePath, Buffer.from(response.data));
    
    return filePath;
  } catch (error) {
    console.error('Görüntü indirme hatası:', error.message);
    throw error;
  }
}

/**
 * Sonucu API'ye gönder
 * @param {Object} request - İstek bilgileri
 * @param {string} photoPath - Gönderilecek fotoğrafın dosya yolu
 */
async function sendResultToAPI(request, photoPath) {
  try {
    console.log(`API isteği için hazırlanıyor - RequestID: ${request.requestId}`);
    
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
    
    // RabbitMQ'dan gelen verileri kullan
    const fields = {
      // number($float) tipleri - Ondalık formatla gönder
      'LegLength': request.legLength?.toString() || '0.0',
      'ArmLength': request.armLength?.toString() || '0.0',
      'ShoulderToCrotch': request.shoulderToCrotch?.toString() || '0.0',
      'Shoulder': request.shoulder?.toString() || '0.0',
      'Chest': request.chest?.toString() || '0.0',
      'Waist': request.waist?.toString() || '0.0',
      'Hip': request.hip?.toString() || '0.0',
      'Thigh': request.thigh?.toString() || '0.0',
      'FootSize': request.footSize?.toString() || '40.0',
      'LowerChest': request.lowerChest?.toString() || '0.0',
      
      // string tipi - Gelen veriyi kullan
      'Gender': request.gender || 'Male',
      'Cup': request.cup || 'A',
      
      // integer($int64) tipi - Gelen veriyi kullan
      'AppUserId': request.appUserId?.toString() || '1',
      
      // integer($int32) tipi - Gelen veriyi kullan
      'Height': request.height?.toString() || '170',
      
      // boolean tipi
      'IsSuccess': 'true',
      
      // string($date-time) tipleri - Gelen veriyi kullan
      'CreateTime': request.timestamp && request.timestamp !== '0001-01-01T00:00:00' ? 
        request.timestamp : new Date().toISOString(),
      'UpdateTime': null
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
    
    console.log(`API isteği gönderiliyor... RequestID: ${request.requestId}`);
    
    // API'ye PUT isteği gönder
    const response = await axios.put(config.api.responseEndpoint, requestData, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'x-api-key': config.api.key,
        'Content-Length': requestData.length
      }
    });
    
    console.log(`API yanıtı - Status: ${response.status}`);
    
    return {
      status: response.status,
      data: response.data,
      requestId: request.requestId
    };
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