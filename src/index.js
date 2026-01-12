const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { connectDatabase } = require('./database/connection');
const { connectRedis } = require('./cache/redis');
const authRoutes = require('./services/auth/routes');
const taskRoutes = require('./services/tasks/routes');
const userRoutes = require('./services/users/routes');
const paymentRoutes = require('./services/payments/routes');
const analyticsRoutes = require('./services/analytics/routes');
const healthRoutes = require('./routes/health');

class TaskLootServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    this.app.use(cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Security and performance middleware
    this.app.use(compression());
    this.app.use(mongoSanitize());
    this.app.use(hpp());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '60 seconds'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api', limiter);

    // Request logging
    this.app.use((req, res, next) => {
      logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      next();
    });
  }

  setupRoutes() {
    const apiVersion = process.env.API_VERSION || 'v1';
    const apiPrefix = `/api/${apiVersion}`;

    // Health check (no versioning)
    this.app.use('/health', healthRoutes);

    // API routes
    this.app.use(`${apiPrefix}/auth`, authRoutes);
    this.app.use(`${apiPrefix}/tasks`, taskRoutes);
    this.app.use(`${apiPrefix}/users`, userRoutes);
    this.app.use(`${apiPrefix}/payments`, paymentRoutes);
    this.app.use(`${apiPrefix}/analytics`, analyticsRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found',
          status: 404
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);
  }

  async start() {
    try {
      // Initialize database connection
      await connectDatabase();
      logger.info('Database connected successfully');

      // Initialize Redis connection
      await connectRedis();
      logger.info('Redis connected successfully');

      // Start server
      this.server = this.app.listen(this.port, () => {
        logger.info(`TaskLoot server running on port ${this.port}`, {
          port: this.port,
          env: process.env.NODE_ENV,
          version: process.env.npm_package_version
        });
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown(signal) {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    
    if (this.server) {
      this.server.close(() => {
        logger.info('HTTP server closed');
      });
    }

    // Close database connections
    try {
      const { pool } = require('./database/connection');
      if (pool) {
        await pool.end();
        logger.info('Database connections closed');
      }
    } catch (error) {
      logger.error('Error closing database:', error);
    }

    // Close Redis connection
    try {
      const { redisClient } = require('./cache/redis');
      if (redisClient) {
        await redisClient.quit();
        logger.info('Redis connection closed');
      }
    } catch (error) {
      logger.error('Error closing Redis:', error);
    }

    process.exit(0);
  }
}

// Start the server
const server = new TaskLootServer();
server.start().catch((error) => {
  logger.error('Failed to start TaskLoot server:', error);
  process.exit(1);
});

module.exports = TaskLootServer;
