const redis = require('redis');

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
};

// Create Redis client
let client;

// Connect to Redis
async function connectRedis() {
  try {
    client = redis.createClient(redisConfig);
    
    client.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });
    
    client.on('connect', () => {
      console.log('🔗 Redis client connected');
    });
    
    client.on('ready', () => {
      console.log('✅ Redis client ready');
    });
    
    await client.connect();
    return client;
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
}

// Get Redis client
function getClient() {
  if (!client) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return client;
}

// Cache operations
const cache = {
  // Set cache with TTL
  async set(key, value, ttl = 3600) {
    try {
      const client = getClient();
      const serializedValue = JSON.stringify(value);
      await client.setEx(key, ttl, serializedValue);
      return true;
    } catch (error) {
      console.error('❌ Cache set error:', error);
      return false;
    }
  },
  
  // Get cache
  async get(key) {
    try {
      const client = getClient();
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('❌ Cache get error:', error);
      return null;
    }
  },
  
  // Delete cache
  async del(key) {
    try {
      const client = getClient();
      await client.del(key);
      return true;
    } catch (error) {
      console.error('❌ Cache delete error:', error);
      return false;
    }
  },
  
  // Check if key exists
  async exists(key) {
    try {
      const client = getClient();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('❌ Cache exists error:', error);
      return false;
    }
  },
  
  // Set cache with expiration
  async setEx(key, seconds, value) {
    try {
      const client = getClient();
      const serializedValue = JSON.stringify(value);
      await client.setEx(key, seconds, serializedValue);
      return true;
    } catch (error) {
      console.error('❌ Cache setEx error:', error);
      return false;
    }
  },
  
  // Increment counter
  async incr(key) {
    try {
      const client = getClient();
      return await client.incr(key);
    } catch (error) {
      console.error('❌ Cache incr error:', error);
      return 0;
    }
  },
  
  // Get multiple keys
  async mget(keys) {
    try {
      const client = getClient();
      const values = await client.mGet(keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      console.error('❌ Cache mget error:', error);
      return [];
    }
  },
  
  // Set multiple keys
  async mset(keyValuePairs) {
    try {
      const client = getClient();
      const serializedPairs = {};
      for (const [key, value] of Object.entries(keyValuePairs)) {
        serializedPairs[key] = JSON.stringify(value);
      }
      await client.mSet(serializedPairs);
      return true;
    } catch (error) {
      console.error('❌ Cache mset error:', error);
      return false;
    }
  }
};

// Session management
const session = {
  // Store user session
  async store(userId, sessionData, ttl = 86400) { // 24 hours default
    const key = `session:${userId}`;
    return await cache.set(key, sessionData, ttl);
  },
  
  // Get user session
  async get(userId) {
    const key = `session:${userId}`;
    return await cache.get(key);
  },
  
  // Delete user session
  async delete(userId) {
    const key = `session:${userId}`;
    return await cache.del(key);
  }
};

// Rate limiting
const rateLimit = {
  // Check rate limit
  async check(key, limit, window) {
    try {
      const client = getClient();
      const current = await client.incr(key);
      
      if (current === 1) {
        await client.expire(key, window);
      }
      
      return {
        allowed: current <= limit,
        count: current,
        limit,
        resetTime: await client.ttl(key)
      };
    } catch (error) {
      console.error('❌ Rate limit check error:', error);
      return { allowed: true, count: 0, limit, resetTime: 0 };
    }
  }
};

// Close Redis connection
async function closeRedis() {
  if (client) {
    await client.quit();
    console.log('🔌 Redis connection closed');
  }
}

module.exports = {
  connectRedis,
  getClient,
  cache,
  session,
  rateLimit,
  closeRedis
};
