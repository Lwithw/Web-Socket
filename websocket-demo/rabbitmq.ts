// rabbitmq.ts - RabbitMQ Message Queue Service
import amqp from 'amqplib';

class MessageQueue {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly QUEUE_NAME = 'offline_messages';
  private readonly EXCHANGE_NAME = 'chat_exchange';

  async connect() {
    try {
      // Connect to RabbitMQ (default: localhost:5672)
      this.connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      this.channel = await this.connection.createChannel();

      // Create exchange for routing
      await this.channel.assertExchange(this.EXCHANGE_NAME, 'direct', { durable: true });

      // Create queue for offline messages
      await this.channel.assertQueue(this.QUEUE_NAME, { durable: true });

      // Bind queue to exchange
      await this.channel.bindQueue(this.QUEUE_NAME, this.EXCHANGE_NAME, 'offline');

      console.log('✅ RabbitMQ connected successfully');
      console.log(`📬 Queue: ${this.QUEUE_NAME}`);
      console.log(`🔄 Exchange: ${this.EXCHANGE_NAME}`);

      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('❌ RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        console.log('🔌 RabbitMQ connection closed');
      });

    } catch (error) {
      console.error('❌ Failed to connect to RabbitMQ:', error);
      console.log('💡 Make sure RabbitMQ is running: docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:management');
      throw error;
    }
  }

  // Queue a message for offline delivery
  async queueOfflineMessage(message: {
    recipientId: string;
    from: string;
    fromUsername: string;
    content: string;
    messageType: 'dm' | 'group';
    messageId: number;
    groupName?: string;
    recipientIds?: string[];
  }) {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      this.channel.publish(
        this.EXCHANGE_NAME,
        'offline',
        messageBuffer,
        { 
          persistent: true, // Survive RabbitMQ restart
          contentType: 'application/json',
          timestamp: Date.now()
        }
      );

      console.log(`📬 Queued offline message for ${message.recipientId}`);
    } catch (error) {
      console.error('❌ Failed to queue message:', error);
      throw error;
    }
  }

  // Process queued messages for a user who just came online
  async processQueuedMessages(userId: string, callback: (message: any) => void) {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    try {
      // Create a temporary queue for this user
      const userQueue = `user_${userId}`;
      await this.channel.assertQueue(userQueue, { durable: false, autoDelete: true });
      await this.channel.bindQueue(userQueue, this.EXCHANGE_NAME, userId);

      // Consume messages
      this.channel.consume(userQueue, (msg) => {
        if (msg) {
          const message = JSON.parse(msg.content.toString());
          callback(message);
          this.channel!.ack(msg); // Acknowledge message
        }
      });

      console.log(`📭 Processing queued messages for ${userId}`);
    } catch (error) {
      console.error('❌ Failed to process queued messages:', error);
    }
  }

  // Get queue statistics
  async getQueueStats() {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    try {
      const queueInfo = await this.channel.checkQueue(this.QUEUE_NAME);
      return {
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount
      };
    } catch (error) {
      console.error('❌ Failed to get queue stats:', error);
      return { messageCount: 0, consumerCount: 0 };
    }
  }

  // Close connection
  async close() {
    try {
      await this.channel?.close();
      await this.connection?.close();
      console.log('✅ RabbitMQ connection closed gracefully');
    } catch (error) {
      console.error('❌ Error closing RabbitMQ connection:', error);
    }
  }
}

export const messageQueue = new MessageQueue();

// Initialize on startup
export async function initMessageQueue() {
  try {
    await messageQueue.connect();
  } catch (error) {
    console.warn('⚠️ RabbitMQ not available. Falling back to database-only mode.');
    return null;
  }
  return messageQueue;
}