const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool = null;

const getDatabaseConfig = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const config = {
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };

  // Pool configuration
  const poolConfig = {
    ...config,
    max: parseInt(process.env.DATABASE_POOL_SIZE) || 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: parseInt(process.env.DATABASE_POOL_TIMEOUT) || 30000,
    maxOverflow: parseInt(process.env.DATABASE_POOL_MAX_OVERFLOW) || 10,
  };

  return poolConfig;
};

const connectDatabase = async () => {
  try {
    const config = getDatabaseConfig();
    pool = new Pool(config);

    // Test the connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    client.release();

    logger.info('Database connected successfully', {
      host: pool.options.host,
      database: pool.options.database,
      currentTime: result.rows[0].current_time,
      version: result.rows[0].version.split(' ')[0]
    });

    // Handle pool errors
    pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', err);
    });

    pool.on('connect', (client) => {
      logger.debug('New client connected to database');
    });

    pool.on('remove', (client) => {
      logger.debug('Client removed from database pool');
    });

    return pool;
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw error;
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return pool;
};

// Transaction helper
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Query helper with logging
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Database query executed', {
      query: text,
      params: params.length > 0 ? params : undefined,
      duration: `${duration}ms`,
      rowCount: result.rowCount
    });

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Database query failed', {
      query: text,
      params: params.length > 0 ? params : undefined,
      duration: `${duration}ms`,
      error: error.message
    });
    throw error;
  }
};

// Health check
const healthCheck = async () => {
  try {
    const result = await query('SELECT 1 as health_check');
    const totalCount = await query('SELECT count(*) as total_connections FROM pg_stat_activity');
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      connections: {
        total: totalCount.rows[0].total_connections,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      query: result.rows[0]
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
};

// Close connection
const closeConnection = async () => {
  if (pool) {
    await pool.end();
    logger.info('Database connection pool closed');
    pool = null;
  }
};

module.exports = {
  connectDatabase,
  getPool,
  query,
  withTransaction,
  healthCheck,
  closeConnection,
  pool: () => pool
};
