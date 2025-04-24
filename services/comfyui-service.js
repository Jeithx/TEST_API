const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const WebSocket = require('ws');
const FormData = require('form-data');
const config = require('../config/config');

/**
 * ComfyUI işlemlerini yönetecek servis
 */
class ComfyUIService {
  constructor() {
    this.apiUrl = config.comfyUI.apiUrl;
    this.workflowPath = config.comfyUI.workflowPath;
    this.outputDir = config.comfyUI.outputDir;
    this.clientId = `node-api-${Date.now()}`;
    this.connected = false;
  }

  /**
   * ComfyUI'ye bağlan ve istem hazırlığını yap
   */
  async initialize() {
    try {
      // Çıktı dizinini oluştur
      await fs.ensureDir(this.outputDir);
      
      // Workflow dosyasının varlığını kontrol et
      if (!await fs.pathExists(this.workflowPath)) {
        throw new Error(`Workflow dosyası bulunamadı: ${this.workflowPath}`);
      }
      
      // ComfyUI'nin çalışıp çalışmadığını kontrol et
      await axios.get(`${this.apiUrl}/system_stats`);
      this.connected = true;
      console.log('ComfyUI bağlantısı başarılı');
      
      return true;
    } catch (error) {
      console.error('ComfyUI bağlantı hatası:', error.message);
      this.connected = false;
      return false;
    }
  }

  /**
   * Giysi simülasyonu işlemini gerçekleştir (Virtual Try-On)
   * @param {string} humanImagePath - Kişinin fotoğrafının dosya yolu
   * @param {string} garmentImagePath - Giysi fotoğrafının dosya yolu
   * @returns {Promise<string>} - Oluşturulan görselin dosya yolu
   */
  async processVirtualTryOn(humanImagePath, garmentImagePath) {
    if (!this.connected) {
      await this.initialize();
      if (!this.connected) {
        throw new Error('ComfyUI servisine bağlanılamadı');
      }
    }

    try {
      console.log('Virtual Try-On işlemi başlatılıyor...');
      console.log(`İnsan görseli: ${humanImagePath}`);
      console.log(`Giysi görseli: ${garmentImagePath}`);
      
      // 1. Önce görselleri ComfyUI'ye yükle
      const humanImageId = await this.uploadImage(humanImagePath);
      const garmentImageId = await this.uploadImage(garmentImagePath);
      
      console.log(`İnsan görseli yüklendi, ID: ${humanImageId}`);
      console.log(`Giysi görseli yüklendi, ID: ${garmentImageId}`);
      
      // 2. Workflow'u oku ve düzenle
      const workflow = await this.getWorkflow();
      
      // İnsan ve giysi görsellerinin node ID'lerini workflow'dan bul
      const humanImageNodeId = this.findNodeByTitle(workflow, "Load Human Image");
      const garmentImageNodeId = this.findNodeByTitle(workflow, "Load Garment Image");
      
      if (!humanImageNodeId || !garmentImageNodeId) {
        throw new Error('Workflow içinde gerekli node\'lar bulunamadı');
      }
      
      // Görselleri workflow'da güncelle
      workflow.nodes.find(n => n.id === humanImageNodeId).widgets_values[0] = humanImageId;
      workflow.nodes.find(n => n.id === garmentImageNodeId).widgets_values[0] = garmentImageId;
      
      console.log('Workflow güncellendi, işlem gönderiliyor...');
      
      // 3. ComfyUI'ye workflow'u gönder ve çalıştır
      const promptResult = await this.executeWorkflow(workflow);
      
      // 4. İşlem sonucunu bekle ve sonuç görselini al
      const outputImage = await this.waitForResult(promptResult.prompt_id);
      
      console.log(`Virtual Try-On işlemi tamamlandı: ${outputImage}`);
      return outputImage;
    } catch (error) {
      console.error('Virtual Try-On işlemi hatası:', error.message);
      throw error;
    }
  }

  /**
   * ComfyUI'ye bir görsel yükle
   * @param {string} imagePath - Yüklenecek görselin dosya yolu
   * @returns {Promise<string>} - Yüklenen görselin ID'si
   */
  async uploadImage(imagePath) {
    try {
      const form = new FormData();
      form.append('image', fs.createReadStream(imagePath), {
        filename: path.basename(imagePath)
      });
      form.append('overwrite', 'true');
      
      const response = await axios.post(
        `${this.apiUrl}/upload/image`, 
        form, 
        { headers: form.getHeaders() }
      );
      
      // Yanıtı kontrol et ve dosya adını döndür
      if (response.status === 200) {
        const fileName = response.data.name || path.basename(imagePath);
        return fileName;
      } else {
        throw new Error(`Görsel yükleme başarısız: ${response.status}`);
      }
    } catch (error) {
      console.error('Görsel yükleme hatası:', error.message);
      throw error;
    }
  }

  /**
   * Workflow dosyasını oku ve JSON olarak parse et
   * @returns {Promise<Object>} - Workflow JSON nesnesi
   */
  async getWorkflow() {
    try {
      const workflowData = await fs.readFile(this.workflowPath, 'utf-8');
      return JSON.parse(workflowData);
    } catch (error) {
      console.error('Workflow okuma hatası:', error.message);
      throw error;
    }
  }

  /**
   * Verilen başlığa sahip node'u bul
   * @param {Object} workflow - Workflow JSON nesnesi
   * @param {string} title - Aranacak başlık
   * @returns {number|null} - Bulunan node ID'si veya null
   */
  findNodeByTitle(workflow, title) {
    const node = workflow.nodes.find(n => n.title === title);
    return node ? node.id : null;
  }

  /**
   * ComfyUI'ye workflow gönder ve çalıştır
   * @param {Object} workflow - Çalıştırılacak workflow
   * @returns {Promise<Object>} - API yanıtı
   */
  async executeWorkflow(workflow) {
    try {
      const response = await axios.post(`${this.apiUrl}/prompt`, workflow);
      return response.data;
    } catch (error) {
      console.error('Workflow çalıştırma hatası:', error.message);
      throw error;
    }
  }

  /**
   * ComfyUI işlem sonucunu WebSocket üzerinden bekle
   * @param {string} promptId - İşlem ID'si
   * @returns {Promise<string>} - Oluşturulan görselin yolu
   */
  waitForResult(promptId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.apiUrl.replace('http', 'ws')}/ws?clientId=${this.clientId}`);
      let outputImagePath = null;
      let timeout = null;
      
      // 5 dakika zaman aşımı
      timeout = setTimeout(() => {
        ws.close();
        reject(new Error('İşlem zaman aşımına uğradı (5 dakika)'));
      }, 300000);
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          
          // İşlem tamamlandığında
          if (message.type === 'executing' && 
              message.data.node === null && 
              message.data.prompt_id === promptId) {
            console.log('ComfyUI işlemi tamamlandı');
            
            if (timeout) clearTimeout(timeout);
            ws.close();
            
            if (outputImagePath) {
              resolve(outputImagePath);
            } else {
              reject(new Error('Görsel çıktısı bulunamadı'));
            }
          }
          
          // Görsel çıktısı oluştuğunda
          if (message.type === 'executed' && 
              message.data.prompt_id === promptId && 
              message.data.output && 
              message.data.output.images) {
            
            const imageData = message.data.output.images[0];
            const imageName = imageData.filename;
            const subfolder = imageData.subfolder || '';
            
            // Görsel URL'sini oluştur
            const imageUrl = `${this.apiUrl}/view?filename=${encodeURIComponent(imageName)}${subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : ''}`;
            
            // Görseli indir
            const imageResponse = await axios.get(imageUrl, {
              responseType: 'arraybuffer'
            });
            
            // Görseli kaydet
            const outputName = `output_${Date.now()}.png`;
            const localImagePath = path.join(this.outputDir, outputName);
            await fs.writeFile(localImagePath, Buffer.from(imageResponse.data));
            
            console.log(`Görsel kaydedildi: ${localImagePath}`);
            outputImagePath = localImagePath;
          }
        } catch (error) {
          console.error('WebSocket mesaj işleme hatası:', error.message);
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket hatası:', error.message);
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      
      ws.on('close', () => {
        if (timeout) clearTimeout(timeout);
        if (!outputImagePath) {
          reject(new Error('WebSocket bağlantısı kapandı, sonuç alınamadı'));
        }
      });
    });
  }
}

// Singleton nesne oluştur
const comfyUIService = new ComfyUIService();

module.exports = comfyUIService;