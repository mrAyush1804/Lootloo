const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let memoryCache = new Map();

const getRedisConfig = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  const config = {
    url: redisUrl,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    keepAlive: 30000,
    connectTimeout: 10000,
    commandTimeout: 5000,
  };

  // Add password if provided
  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  // Add database number if provided
  if (process.env.REDIS_DB) {
    config.db = parseInt(process.env.REDIS_DB);
  }

  return config;
};

const connectRedis = async () => {
  try {
    const config = getRedisConfig();
    redisClient = new Redis(config);

    // Event listeners
    redisClient.on('connect', () => {
      logger.info('Redis client connecting');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redisClient.on('close', () => {
      logger.warn('Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });

    // Connect to Redis
    await redisClient.connect();

    // Test connection
    const pong = await redisClient.ping();
    logger.info('Redis connected successfully', { response: pong });

    return redisClient;
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

const getClient = () => {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

// Cache service with multiple tiers
class CacheService {
  constructor() {
    this.defaultTTL = parseInt(process.env.CACHE_TTL_SECONDS) || 300;
    this.memoryCacheMaxSize = parseInt(process.env.MEMORY_CACHE_SIZE) || 1000;
  }

  // Memory cache methods
  setMemory(key, value, ttl = 60) {
    // Implement LRU eviction if cache is full
    if (memoryCache.size >= this.memoryCacheMaxSize) {
      const firstKey = memoryCache.keys().next().value;
      memoryCache.delete(firstKey);
    }

    memoryCache.set(key, {
      value,
      expires: Date.now() + (ttl * 1000)
    });
  }

  getMemory(key) {
    const item = memoryCache.get(key);
    if (!item) return null;

    if (Date.now() > item.expires) {
      memoryCache.delete(key);
      return null;
    }

    return item.value;
  }

  deleteMemory(key) {
    memoryCache.delete(key);
  }

  // Redis cache methods
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const serializedValue = JSON.stringify(value);
      await redisClient.setex(key, ttl, serializedValue);
      
      // Also set in memory cache for faster access
      this.setMemory(key, value, Math.min(ttl, 60));
      
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    try {
      // Try memory cache first
      const memoryValue = this.getMemory(key);
      if (memoryValue !== null) {
        return memoryValue;
      }

      // Try Redis
      const value = await redisClient.get(key);
      if (value === null) {
        return null;
      }

      const parsedValue = JSON.parse(value);
      
      // Store in memory cache for next time
      this.setMemory(key, parsedValue, 60);
      
      return parsedValue;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  async del(key) {
    try {
      await redisClient.del(key);
      this.deleteMemory(key);
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    try {
      // Check memory cache first
      if (this.getMemory(key) !== null) {
        return true;
      }

      // Check Redis
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', error);
      return false;
    }
  }

  async incr(key, amount = 1) {
    try {
      const result = await redisClient.incrby(key, amount);
      return result;
    } catch (error) {
      logger.error('Cache increment error:', error);
      return null;
    }
  }

  async expire(key, ttl) {
    try {
      await redisClient.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error('Cache expire error:', error);
      return false;
    }
  }

  async ttl(key) {
    try {
      const result = await redisClient.ttl(key);
      return result;
    } catch (error) {
      logger.error('Cache TTL error:', error);
      return -1;
    }
  }

  // Queue operations for analytics
  async pushToQueue(queueName, data) {
    try {
      const serializedData = JSON.stringify(data);
      await redisClient.lpush(queueName, serializedData);
      return true;
    } catch (error) {
      logger.error('Queue push error:', error);
      return false;
    }
  }

  async popFromQueue(queueName) {
    try {
      const data = await redisClient.rpop(queueName);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Queue pop error:', error);
      return null;
    }
  }

  async getQueueLength(queueName) {
    try {
      const length = await redisClient.llen(queueName);
      return length;
    } catch (error) {
      logger.error('Queue length error:', error);
      return 0;
    }
  }

  // Rate limiting
  async checkRateLimit(key, maxRequests, windowSeconds) {
    try {
      const current = await redisClient.incr(key);
      
      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }

      const ttl = await redisClient.ttl(key);
      
      return {
        allowed: current <= maxRequests,
        remaining: Math.max(0, maxRequests - current),
        resetTime: ttl > 0 ? Date.now() + (ttl * 1000) : null
      };
    } catch (error) {
      logger.error('Rate limit check error:', error);
      return { allowed: true, remaining: maxRequests, resetTime: null };
    }
  }

  // Health check
  async healthCheck() {
    try {
      const start = Date.now();
      await redisClient.ping();
      const responseTime = Date.now() - start;
      
      const info = await redisClient.info('memory');
      const memoryUsed = info.split('\r\n')
        .find(line => line.startsWith('used_memory_human:'))
        ?.split(':')[1];

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        memoryUsed,
        memoryCacheSize: memoryCache.size
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  // Clear all cache (for testing)
  async clear() {
    try {
      await redisClient.flushdb();
      memoryCache.clear();
      return true;
    } catch (error) {
      logger.error('Cache clear error:', error);
      return false;
    }
  }
}

const cacheService = new CacheService();

module.exports = {
  connectRedis,
  getClient,
  cacheService,
  redisClient: () => redisClient
};
