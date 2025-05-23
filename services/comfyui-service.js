const WebSocket = require('ws');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');

class ComfyUIService {
  constructor() {
    this.comfyUrl = config.comfyUI.serverUrl;
    this.clientId = uuidv4();
    this.socket = null;
    this.connected = false;
    this.processingQueue = [];
    this.isProcessing = false;
    this.activePromptId = null;
    this.tempImageDir = path.join(__dirname, '../temp_images');
    this.workflowPath = config.comfyUI.workflowPath;
    this.listeners = new Map();

    // Temp dizini oluştur
    fs.ensureDirSync(this.tempImageDir);
    console.log(`ComfyUI servisi başlatıldı. ID: ${this.clientId}`);
  }
  
  // WebSocket bağlantısını başlat
  async connect() {
    if (this.socket && this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(`${this.comfyUrl}/ws?clientId=${this.clientId}`);
        
        this.socket.on('open', () => {
          console.log('ComfyUI WebSocket bağlantısı kuruldu');
          this.connected = true;
          resolve();
        });

        this.socket.on('message', (data) => {
          this.handleMessage(data);
        });

        this.socket.on('error', (error) => {
          console.error('ComfyUI WebSocket hatası:', error.message);
          this.connected = false;
          reject(error);
        });

        this.socket.on('close', () => {
          console.log('ComfyUI WebSocket bağlantısı kapandı');
          this.connected = false;
          
          // Yeniden bağlanma
          setTimeout(() => {
            if (!this.connected) {
              console.log('ComfyUI WebSocket yeniden bağlanılıyor...');
              this.connect().catch(err => {
                console.error('WebSocket yeniden bağlantı hatası:', err.message);
              });
            }
          }, 5000);
        });
      } catch (error) {
        console.error('ComfyUI bağlantı hatası:', error.message);
        reject(error);
      }
    });
  }

  // WebSocket mesajlarını işle
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      // Mesaj tiplerine göre işleme
      switch (message.type) {
        case 'status':
          // ComfyUI durumu
          console.log(`ComfyUI Durumu: ${message.data.status}`);
          break;
          
        case 'execution_start':
          // Workflow çalışmaya başladı
          console.log(`Workflow çalışmaya başladı. Prompt ID: ${message.data.prompt_id}`);
          break;
          
        case 'execution_cached':
          // Önbelleğe alınmış sonuç
          console.log(`Önbelleğe alınmış sonuç. Prompt ID: ${message.data.prompt_id}`);
          break;
          
        case 'executing':
          // Düğüm çalıştırılıyor
          if (message.data.node === null) {
            // Execution tamamlandı
            console.log(`Workflow tamamlandı. Prompt ID: ${this.activePromptId}`);
          }
          break;
          
        case 'executed':
          // Bir düğüm çalıştırıldı
          if (message.data.output && message.data.output.images) {
            // Görüntü üretildi
            this.handleImageOutput(message.data);
          }
          break;
          
        case 'execution_error':
          // Hata oluştu
          console.error(`Execution hatası: ${message.data.exception_message}`);
          if (this.listeners.has('error')) {
            this.listeners.get('error')(message.data.exception_message);
          }
          break;
      }
    } catch (error) {
      console.error('WebSocket mesajı işleme hatası:', error.message);
    }
  }

  // Üretilen görüntüyü işle
  async handleImageOutput(data) {
    try {
      // Aktif bir prompt yoksa veya listenerlar yoksa işleme
      if (!this.activePromptId || !this.listeners.has('result')) {
        return;
      }

      const images = data.output.images;
      
      // Her üretilen görüntüyü işle
      for (const image of images) {
        // Görüntüyü indir
        const imageUrl = `${this.comfyUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}&type=${image.type}`;
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        
        // Temp klasörüne kaydet
        const outputImagePath = path.join(this.tempImageDir, image.filename);
        await fs.writeFile(outputImagePath, Buffer.from(response.data));
        console.log(`Görüntü kaydedildi: ${outputImagePath}`);
        
        // Sonucu bildir
        if (this.listeners.has('result')) {
          this.listeners.get('result')({
            promptId: this.activePromptId,
            imagePath: outputImagePath,
            imageData: Buffer.from(response.data)
          });
        }
      }
      
      // İşlem tamamlandı, sıradaki isteği işle
      setTimeout(() => {
        this.processNextRequest();
      }, 1000);
    } catch (error) {
      console.error('Görüntü işleme hatası:', error.message);
      
      if (this.listeners.has('error')) {
        this.listeners.get('error')(error.message);
      }
      
      // Hata durumunda da sıradaki isteği işle
      this.processNextRequest();
    }
  }

  // Olay dinleyicisi ekle
  on(event, callback) {
    this.listeners.set(event, callback);
  }

  // Görüntü yükle ve node ID'sini döndür
  async uploadImage(imagePath, filename = null) {
    try {
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Dosya bulunamadı: ${imagePath}`);
      }
      
      // Dosya adı belirtilmemişse orijinal dosya adını kullan
      const uploadFilename = filename || path.basename(imagePath);
      console.log(`Görüntü yükleniyor: ${uploadFilename}`);
      
      // Dosyayı oku
      const imageBuffer = await fs.readFile(imagePath);
      
      // Multipart boundary oluştur
      const boundary = `----FormBoundary${Math.random().toString(16).substr(2)}`;
      
      // Manuel multipart/form-data oluştur
      let requestBody = [];
      
      // Dosya ekle
      requestBody.push(Buffer.from(`--${boundary}\r\n`));
      requestBody.push(Buffer.from(`Content-Disposition: form-data; name="image"; filename="${uploadFilename}"\r\n`));
      requestBody.push(Buffer.from(`Content-Type: image/jpeg\r\n\r\n`));
      requestBody.push(imageBuffer);
      requestBody.push(Buffer.from(`\r\n`));
      
      // overwrite parametresi
      requestBody.push(Buffer.from(`--${boundary}\r\n`));
      requestBody.push(Buffer.from(`Content-Disposition: form-data; name="overwrite"\r\n\r\n`));
      requestBody.push(Buffer.from(`true\r\n`));
      
      // Son boundary
      requestBody.push(Buffer.from(`--${boundary}--\r\n`));
      
      // Buffer'ları birleştir
      const requestData = Buffer.concat(requestBody);
      
      // Manuel multipart/form-data isteği gönder
      const uploadUrl = `${this.comfyUrl}/upload/image`;
      const response = await axios.post(uploadUrl, requestData, {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': requestData.length
        }
      });
      
      if (response.status === 200) {
        const data = response.data;
        if (data.name && data.type) {
          console.log(`Görüntü başarıyla yüklendi: ${data.name}`);
          return {
            filename: data.name,
            type: data.type
          };
        }
      }
      
      throw new Error('Görüntü yükleme başarısız: Beklenmeyen yanıt');
    } catch (error) {
      console.error('Görüntü yükleme hatası:', error.message);
      
      if (error.response) {
        console.error('Yanıt detayları:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      
      throw error; // Hata durumunda geçersiz dosya adı döndürmek yerine hatayı ilet
    }
  }

  // İşleme kuyruğuna istek ekle
  queueRequest(requestId, humanImagePath, garmentImagePath = null) {
    return new Promise((resolve, reject) => {
      const request = {
        id: requestId,
        humanImagePath,
        garmentImagePath,
        resolve,
        reject
      };
      
      this.processingQueue.push(request);
      console.log(`İstek kuyruğa eklendi. ID: ${requestId}, Kuyruk uzunluğu: ${this.processingQueue.length}`);
      
      // İşlem yapılmıyorsa hemen başlat
      if (!this.isProcessing) {
        this.processNextRequest();
      }
    });
  }

  // Workflow'u insan ve kıyafet görüntüsüyle güncelle - EN BASİT VERSİYON
  async updateWorkflowWithImages(humanImagePath, garmentImagePath = null) {
    try {
      // 1. Orijinal workflow dosyasını oku
      if (!fs.existsSync(this.workflowPath)) {
        throw new Error(`Workflow dosyası bulunamadı: ${this.workflowPath}`);
      }
      const workflowJson = await fs.readFile(this.workflowPath, 'utf-8');
      let workflow = JSON.parse(workflowJson);
      
      console.log("Orijinal workflow dosyası yüklendi.");
      
      // 2. Görüntüleri ComfyUI'ye yükle
      const timestamp = Date.now();
      const humanImageFilename = `human_${timestamp}.png`;
      const garmentImageFilename = garmentImagePath ? `garment_${timestamp}.jpg` : null;
      
      console.log(`İnsan görseli yükleniyor: ${humanImageFilename}`);
      const humanImage = await this.uploadImage(humanImagePath, humanImageFilename);
      let garmentImage = null;
      
      if (garmentImagePath && fs.existsSync(garmentImagePath)) {
        console.log(`Kıyafet görseli yükleniyor: ${garmentImageFilename}`);
        garmentImage = await this.uploadImage(garmentImagePath, garmentImageFilename);
      }
      
      // 3. API formatına dönüştürme işlemi (eğer modern/export formatındaysa)
      let apiWorkflow = {};
      
      if (workflow.nodes && Array.isArray(workflow.nodes)) {
        console.log("Modern/Export formatında workflow tespit edildi.");
        
        // Tüm nodes'ları API formatına dönüştür
        for (const node of workflow.nodes) {
          apiWorkflow[node.id] = {
            class_type: node.type,
            inputs: {},
            widgets_values: node.widgets_values || []
          };
          
          // Input bağlantılarını kur
          if (node.inputs) {
            for (const input of node.inputs) {
              if (input.link !== null) {
                const link = workflow.links.find(l => l[0] === input.link);
                if (link) {
                  apiWorkflow[node.id].inputs[input.name] = [link[1], link[2]];
                }
              }
            }
          }
          
          // Görüntü yükleme node'larını güncelle
          if (node.type === "LoadImage") {
            if (node.title === "Load Human Image") {
              if (!apiWorkflow[node.id].widgets_values) {
                apiWorkflow[node.id].widgets_values = [];
              }
              apiWorkflow[node.id].widgets_values[0] = humanImage.filename;
              console.log(`İnsan görseli node'u güncellendi: ${humanImage.filename}`);
            } else if (node.title === "Load Garment Image" && garmentImage) {
              if (!apiWorkflow[node.id].widgets_values) {
                apiWorkflow[node.id].widgets_values = [];
              }
              apiWorkflow[node.id].widgets_values[0] = garmentImage.filename;
              console.log(`Kıyafet görseli node'u güncellendi: ${garmentImage.filename}`);
            }
          }
        }
      } else {
        // Zaten API formatında
        console.log("API formatında workflow tespit edildi.");
        apiWorkflow = workflow;
        
        // LoadImage node'larını bul ve güncelle
        for (const id in apiWorkflow) {
          if (isNaN(id)) continue;
          
          const node = apiWorkflow[id];
          if (node.class_type === "LoadImage") {
            if (node.title === "Load Human Image") {
              if (!node.widgets_values) {
                node.widgets_values = [];
              }
              node.widgets_values[0] = humanImage.filename;
              console.log(`İnsan görseli node'u güncellendi: ${humanImage.filename}`);
            } else if (node.title === "Load Garment Image" && garmentImage) {
              if (!node.widgets_values) {
                node.widgets_values = [];
              }
              node.widgets_values[0] = garmentImage.filename;
              console.log(`Kıyafet görseli node'u güncellendi: ${garmentImage.filename}`);
            }
          }
        }
      }
      
      // 4. Reroute node'unu kaldır (eğer varsa)
      if (apiWorkflow['39']) {
        console.log("Reroute node (#39) kaldırılıyor...");
        delete apiWorkflow['39'];
        
        // Reroute referanslarını temizle
        for (const id in apiWorkflow) {
          if (isNaN(id)) continue;
          const node = apiWorkflow[id];
          if (node.inputs) {
            for (const inputName in node.inputs) {
              const input = node.inputs[inputName];
              if (Array.isArray(input) && input[0] === 39) {
                // Bağlantıyı ImageScale (#50) node'una yönlendir
                console.log(`Node #${id} (${inputName}) Reroute referansı düzeltiliyor`);
                node.inputs[inputName] = [50, 0];
              }
            }
          }
        }
      }
      
      // 5. Workflow'u döndür
      console.log("Workflow başarıyla güncellendi.");
      return apiWorkflow;
    } catch (err) {
      console.error('Workflow güncelleme hatası:', err.message);
      throw err;
    }
  }

  // En basit şekilde workflow'u çalıştır
  async runWorkflow(workflow) {
    try {
      if (!this.connected) {
        await this.connect();
      }
      
      // En basit API isteği oluştur
      const promptPayload = {
        prompt: workflow,
        client_id: this.clientId
      }
      
      // Debug için dosyaya kaydet
      const dumpPath = path.join(__dirname, `prompt-${Date.now()}.json`);
      fs.writeFileSync(dumpPath, JSON.stringify(workflow, null, 2), 'utf-8');
      console.log(`► Prompt JSON debug dosyası: ${dumpPath}`);
      
      console.log("ComfyUI'ye prompt gönderiliyor...");
      
      // API'ye prompt gönder
      const response = await axios.post(`${this.comfyUrl}/prompt`, promptPayload);
      
      if (response.status === 200) {
        const promptId = response.data.prompt_id;
        this.activePromptId = promptId;
        console.log(`Workflow başlatıldı. Prompt ID: ${promptId}`);
        return promptId;
      }
      
      throw new Error('Workflow başlatma başarısız: Beklenmeyen yanıt');
    } catch (error) {
      console.error('Workflow çalıştırma hatası:', error.message);
      
      if (error.response) {
        console.error('Hata detayları:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }
      
      throw error;
    }
  }

  // Sıradaki isteği işle
  async processNextRequest() {
    // İşlem yapılıyorsa veya kuyruk boşsa çık
    if (this.isProcessing || this.processingQueue.length === 0) {
      if (this.processingQueue.length === 0) {
        this.isProcessing = false;
        console.log('İşlem kuyruğu boş.');
      }
      return;
    }
    
    this.isProcessing = true;
    const request = this.processingQueue.shift();
    console.log(`İstek işleniyor. ID: ${request.id}, Kalan kuyruk: ${this.processingQueue.length}`);
    
    try {
      // Bağlantı kontrolü
      if (!this.connected) {
        await this.connect();
      }
      
      // Dosyaların var olduğunu kontrol et
      if (!fs.existsSync(request.humanImagePath)) {
        throw new Error(`İnsan görüntüsü bulunamadı: ${request.humanImagePath}`);
      }
      
      // Garment görüntüsü zorunlu değilse kontrol etme
      if (request.garmentImagePath && !fs.existsSync(request.garmentImagePath)) {
        throw new Error(`Kıyafet görüntüsü bulunamadı: ${request.garmentImagePath}`);
      }
      
      // Workflow'u güncelle
      const updatedWorkflow = await this.updateWorkflowWithImages(
        request.humanImagePath,
        request.garmentImagePath
      );
      
      // Sonuç dinleyicisini tanımla
      const resultPromise = new Promise((resolve, reject) => {
        const resultHandler = (result) => {
          this.listeners.delete('result');
          this.listeners.delete('error');
          resolve(result);
        };
        
        const errorHandler = (error) => {
          this.listeners.delete('result');
          this.listeners.delete('error');
          reject(new Error(error));
        };
        
        this.on('result', resultHandler);
        this.on('error', errorHandler);
        
        // 5 dakika zaman aşımı
        setTimeout(() => {
          if (this.listeners.has('result')) {
            this.listeners.delete('result');
            this.listeners.delete('error');
            reject(new Error('Workflow işlemi zaman aşımına uğradı.'));
            this.processNextRequest();
          }
        }, 300000); // 5 dakika
      });
      
      // Workflow'u çalıştır
      await this.runWorkflow(updatedWorkflow);
      
      // Sonucu bekle
      const result = await resultPromise;
      request.resolve(result);
    } catch (error) {
      console.error(`İstek işleme hatası (ID: ${request.id}):`, error.message);
      request.reject(error);
      
      // Hata durumunda da sıradaki isteği işle
      setTimeout(() => {
        this.isProcessing = false;
        this.processNextRequest();
      }, 1000);
    }
  }

  // Servis temizliği
  async cleanup() {
    // Temp klasöründeki görüntüleri temizle
    const files = await fs.readdir(this.tempImageDir);
    for (const file of files) {
      await fs.remove(path.join(this.tempImageDir, file));
    }
    
    console.log('Temp görüntü klasörü temizlendi.');
  }
}

// Singleton instance
const comfyUIService = new ComfyUIService();

module.exports = comfyUIService;