const express = require('express');
const { healthCheck: dbHealthCheck } = require('../database/connection');
const { cacheService } = require('../cache/redis');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Check database health
    const dbHealth = await dbHealthCheck();
    
    // Check Redis health
    const redisHealth = await cacheService.healthCheck();
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Determine overall health
    const isHealthy = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';
    
    const healthData = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: `${responseTime}ms`,
      services: {
        database: dbHealth,
        redis: redisHealth
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
        },
        cpu: process.cpuUsage()
      }
    };

    const statusCode = isHealthy ? 200 : 503;
    
    res.status(statusCode).json(healthData);
    
  } catch (error) {
    logger.error('Health check failed:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @route   GET /health/ready
 * @desc    Readiness probe (checks if service is ready to accept traffic)
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  try {
    // Check critical dependencies
    const dbHealth = await dbHealthCheck();
    const redisHealth = await cacheService.healthCheck();
    
    const isReady = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';
    
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth.status,
          redis: redisHealth.status
        }
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * @route   GET /health/live
 * @desc    Liveness probe (checks if service is alive)
 * @access  Public
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
