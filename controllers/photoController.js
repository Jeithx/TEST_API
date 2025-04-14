const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');
const producerService = require('../services/producer');

/**
 * Fotoğraf işleme isteği oluştur
 */
async function createPhotoProcessingRequest(req, res) {
  try {
    const { photoUrl } = req.body;
    
    if (!photoUrl) {
      return res.status(400).json({
        success: false,
        message: 'photoUrl alanı gereklidir'
      });
    }
    
    // Fotoğraf işleme isteği oluştur
    const requestId = await producerService.sendPhotoProcessingRequest(photoUrl);
    
    return res.status(202).json({
      success: true,
      message: 'Fotoğraf işleme isteği alındı',
      requestId
    });
  } catch (error) {
    console.error('Fotoğraf işleme hatası:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Fotoğraf işleme isteği oluşturulamadı',
      error: error.message
    });
  }
}

/**
 * 20 örnek fotoğraf oluştur (eğer yoksa)
 */
async function initializePhotos() {
  try {
    const photosDir = config.photos.directory;
    
    // Fotoğraf dizini oluştur (yoksa)
    await fs.ensureDir(photosDir);
    
    // Dizindeki mevcut fotoğrafları kontrol et
    const files = await fs.readdir(photosDir);
    
    // Eğer dosya varsa, işlem yapma
    if (files.length > 0) {
      console.log(`${files.length} fotoğraf zaten mevcut.`);
      return;
    }
    
    console.log('Uyarı: photos klasöründe gerçek fotoğraf bulunamadı.');
    console.log('Lütfen photos klasörüne 20 adet gerçek .jpg fotoğraf ekleyin!');
  } catch (error) {
    console.error('Fotoğraf kontrol hatası:', error.message);
    throw error;
  }
}

module.exports = {
  createPhotoProcessingRequest,
  initializePhotos
};