const amqp = require('amqplib');
const config = require('../config/config');

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.connected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 10; // Maksimum bağlantı deneme sayısı
    this.connectionTimeout = 5000; // ms cinsinden yeniden bağlanma süresi
  }

  async connect() {
    try {
      this.connectionAttempts++;
      const { hostName, port, userName, password, environment } = config.rabbitMQ;
      const connectionString = `amqp://${userName}:${password}@${hostName}:${port}/${environment}`;
      
      console.log(`RabbitMQ bağlantısı deneniyor: ${hostName}:${port} (Deneme: ${this.connectionAttempts})`);
      
      this.connection = await amqp.connect(connectionString);
      this.channel = await this.connection.createChannel();
      
      // Queue'yu kontrol et
      await this.channel.assertQueue(config.rabbitMQ.queueName, {
        durable: true
      });
      
      this.connected = true;
      this.connectionAttempts = 0; // Başarılı bağlantıda sıfırla
      console.log('RabbitMQ\'ya başarıyla bağlanıldı');
      
      // Bağlantı kapatıldığında tekrar bağlanma
      this.connection.on('close', () => {
        console.log('RabbitMQ bağlantısı kapatıldı. Yeniden bağlanılıyor...');
        this.connected = false;
        setTimeout(() => this.connect(), this.connectionTimeout);
      });
      
      this.connection.on('error', (err) => {
        console.error('RabbitMQ bağlantı hatası:', err.message);
        this.connected = false;
      });
      
      return this.channel;
    } catch (error) {
      console.error('RabbitMQ bağlantısı kurulamadı:', error.message);
      this.connected = false;
      
      // Maksimum deneme sayısını aşmadıysa yeniden dene
      if (this.connectionAttempts < this.maxConnectionAttempts) {
        console.log(`${this.connectionTimeout / 1000} saniye sonra yeniden bağlanmaya çalışılacak...`);
        setTimeout(() => this.connect(), this.connectionTimeout);
      } else {
        console.error(`Maksimum bağlantı deneme sayısına (${this.maxConnectionAttempts}) ulaşıldı. Bağlantı denemesi durduruldu.`);
        // İsterseniz burada process.exit(1) ile uygulamayı sonlandırabilirsiniz
        // Veya bir flag belirleyip ana uygulama akışına devam edebilirsiniz
      }
      
      throw error;
    }
  }

  async getChannel() {
    if (!this.connected) {
      await this.connect();
    }
    return this.channel;
  }

  async closeConnection() {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
    this.connected = false;
    console.log('RabbitMQ bağlantısı kapatıldı');
  }
}

// Singleton instance
const rabbitMQService = new RabbitMQService();

module.exports = rabbitMQService;