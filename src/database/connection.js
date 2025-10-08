const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ai_calorie_tracker',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
};

// Create connection pool
const pool = new Pool(dbConfig);

// Test database connection
async function connectDB() {
  try {
    const client = await pool.connect();
    console.log('📊 Database connection established');
    
    // Test query
    const result = await client.query('SELECT NOW()');
    console.log('🕐 Database time:', result.rows[0].now);
    
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

// Execute query with error handling
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('📝 Query executed', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('❌ Query error:', error.message);
    throw error;
  }
}

// Get a client from the pool for transactions
async function getClient() {
  return await pool.connect();
}

// Close the pool
async function closePool() {
  await pool.end();
}

// Database initialization
async function initializeDatabase() {
  try {
    // Read and execute schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await query(schema);
      console.log('✅ Database schema initialized');
    }
    
    // Read and execute seed file if in development
    if (process.env.NODE_ENV === 'development') {
      const seedPath = path.join(__dirname, 'seed.sql');
      if (fs.existsSync(seedPath)) {
        const seed = fs.readFileSync(seedPath, 'utf8');
        await query(seed);
        console.log('🌱 Database seeded with initial data');
      }
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

module.exports = {
  pool,
  query,
  getClient,
  connectDB,
  closePool,
  initializeDatabase
};
