const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { cacheService } = require('../cache/redis');
const { query } = require('../database/connection');
const logger = require('../utils/logger');
const {
  UnauthorizedError,
  ForbiddenError,
  RateLimitError
} = require('./errorHandler');

// JWT verification middleware
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Access token is required');
    }

    const token = authHeader.split(' ')[1];

    // Check if token is blacklisted
    const isBlacklisted = await authService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Verify token
    const decoded = authService.verifyToken(token);

    // Attach user info to request
    req.user = decoded;
    req.token = token;

    next();
  } catch (error) {
    next(error);
  }
};

// Role-based access control middleware
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.security('Unauthorized access attempt', {
        userId: req.user.sub,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        url: req.url,
        method: req.method,
        ip: req.ip
      });

      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
};

// Resource ownership middleware
const requireOwnership = (resourceType, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      const userId = req.user.sub;
      const resourceId = req.params[resourceIdParam];

      if (!resourceId) {
        return next(new UnauthorizedError('Resource ID is required'));
      }

      let queryText;
      let queryParams;

      switch (resourceType) {
        case 'task':
          queryText = 'SELECT company_id FROM tasks WHERE id = $1';
          queryParams = [resourceId];
          break;
        case 'user_profile':
          queryText = 'SELECT user_id FROM user_profiles WHERE id = $1';
          queryParams = [resourceId];
          break;
        case 'company_profile':
          queryText = 'SELECT user_id FROM company_profiles WHERE id = $1';
          queryParams = [resourceId];
          break;
        default:
          return next(new UnauthorizedError('Invalid resource type'));
      }

      const result = await query(queryText, queryParams);

      if (result.rows.length === 0) {
        return next(new UnauthorizedError('Resource not found'));
      }

      const resourceOwnerId = result.rows[0].company_id || result.rows[0].user_id;

      // Admin can access any resource
      if (req.user.role === 'admin') {
        return next();
      }

      // Check ownership
      if (resourceOwnerId !== userId) {
        logger.security('Unauthorized resource access attempt', {
          userId,
          resourceId,
          resourceType,
          resourceOwnerId,
          url: req.url,
          method: req.method,
          ip: req.ip
        });

        return next(new ForbiddenError('Access denied to this resource'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// API key authentication middleware (for webhooks)
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return next(new UnauthorizedError('API key is required'));
  }

  // Validate API key against environment variables or database
  const validApiKeys = [
    process.env.RAZORPAY_WEBHOOK_SECRET,
    process.env.SENDGRID_WEBHOOK_SECRET
  ].filter(Boolean);

  if (!validApiKeys.includes(apiKey)) {
    logger.security('Invalid API key attempt', {
      apiKey: apiKey.substring(0, 8) + '...',
      url: req.url,
      method: req.method,
      ip: req.ip
    });

    return next(new UnauthorizedError('Invalid API key'));
  }

  next();
};

// Rate limiting middleware with user-specific limits
const userRateLimit = (maxRequests = 100, windowSeconds = 60) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.ip;
      const key = `rate_limit:user:${userId}`;

      const result = await cacheService.checkRateLimit(key, maxRequests, windowSeconds);

      if (!result.allowed) {
        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': result.resetTime
        });

        return next(new RateLimitError('Rate limit exceeded'));
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': result.resetTime
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Request ID middleware
const requestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.set('X-Request-ID', req.id);
  next();
};

// Optional authentication middleware (doesn't throw error if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      // Check if token is blacklisted
      const isBlacklisted = await authService.isTokenBlacklisted(token);
      if (!isBlacklisted) {
        try {
          const decoded = authService.verifyToken(token);
          req.user = decoded;
          req.token = token;
        } catch (error) {
          // Token is invalid, but we don't throw error for optional auth
          logger.debug('Invalid optional auth token', { error: error.message });
        }
      }
    }

    next();
  } catch (error) {
    // Don't throw error for optional auth
    next();
  }
};

// Email verification middleware
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  // Admin users don't need email verification
  if (req.user.role === 'admin') {
    return next();
  }

  // Check if user's email is verified
  // This would typically be checked from the database
  // For now, we'll assume it's checked in the user object
  if (req.user.emailVerified === false) {
    return next(new ForbiddenError('Email verification required'));
  }

  next();
};

// Company verification middleware
const requireCompanyVerification = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    // Admin users don't need company verification
    if (req.user.role === 'admin') {
      return next();
    }

    // Only companies need verification
    if (req.user.role !== 'company') {
      return next();
    }

    // Check company KYC status
    const result = await query(
      'SELECT kyc_status FROM company_profiles WHERE user_id = $1',
      [req.user.sub]
    );

    if (result.rows.length === 0) {
      return next(new ForbiddenError('Company profile not found'));
    }

    const { kyc_status } = result.rows[0];

    if (kyc_status !== 'verified') {
      return next(new ForbiddenError('Company KYC verification required'));
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authMiddleware,
  requireRole,
  requireOwnership,
  apiKeyAuth,
  userRateLimit,
  requestId,
  optionalAuth,
  requireEmailVerification,
  requireCompanyVerification
};
