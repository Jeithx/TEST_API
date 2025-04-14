const amqp = require('amqplib');
const config = require('../config/config');

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.connected = false;
  }

  async connect() {
    try {
      const { hostName, userName, password, environment } = config.rabbitMQ;
      const connectionString = `amqp://${userName}:${password}@${hostName}/${environment}`;
      
      this.connection = await amqp.connect(connectionString);
      this.channel = await this.connection.createChannel();
      
      // Queue oluşturma
      await this.channel.assertQueue(config.rabbitMQ.queueName, {
        durable: true
      });
      
      this.connected = true;
      console.log('RabbitMQ\'ya başarıyla bağlanıldı');
      
      // Bağlantı kapatıldığında tekrar bağlanma
      this.connection.on('close', () => {
        console.log('RabbitMQ bağlantısı kapatıldı. Yeniden bağlanılıyor...');
        this.connected = false;
        setTimeout(() => this.connect(), 5000);
      });
      
      return this.channel;
    } catch (error) {
      console.error('RabbitMQ bağlantısı kurulamadı:', error.message);
      this.connected = false;
      setTimeout(() => this.connect(), 5000);
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