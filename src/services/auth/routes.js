const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authService = require('./service');
const { asyncHandler, handleJoiError } = require('../../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    return handleJoiError({ details });
  }
  next();
};

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: {
    error: 'Too many registration attempts, please try again later.',
    retryAfter: '1 hour'
  }
});

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register',
  registerLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number, and special character'),
    body('role')
      .isIn(['player', 'company'])
      .withMessage('Role must be either player or company'),
    body('name')
      .isLength({ min: 2, max: 100 })
      .withMessage('Name must be between 2 and 100 characters'),
    body('phone')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Invalid Indian phone number format')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { email, password, role, name, phone } = req.body;

    const result = await authService.register({
      email,
      password,
      role,
      name,
      phone
    });

    logger.info('User registration successful', {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const result = await authService.login(email, password, req.ip);

    logger.info('User login successful', {
      userId: result.user.id,
      email: result.user.email,
      ip: req.ip
    });

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/refresh-token
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh-token',
  [
    body('refresh_token')
      .notEmpty()
      .withMessage('Refresh token is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;

    const tokens = await authService.refreshToken(refresh_token);

    res.json({
      success: true,
      data: tokens,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const userId = req.user.sub;

    await authService.logout(userId, token);

    logger.info('User logout successful', {
      userId,
      ip: req.ip
    });

    res.json({
      success: true,
      data: { message: 'Logged out successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post('/forgot-password',
  authLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    const result = await authService.forgotPassword(email);

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password',
  authLimiter,
  [
    body('reset_token')
      .notEmpty()
      .withMessage('Reset token is required'),
    body('new_password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number, and special character')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { reset_token, new_password } = req.body;

    const result = await authService.resetPassword(reset_token, new_password);

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email with token
 * @access  Public
 */
router.post('/verify-email',
  [
    body('verification_token')
      .notEmpty()
      .withMessage('Verification token is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { verification_token } = req.body;

    const result = await authService.verifyEmail(verification_token);

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user info
 * @access  Private
 */
router.get('/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;

    // Get user info from database
    const { query } = require('../../database/connection');
    const result = await query(
      `SELECT u.id, u.email, u.role, u.is_verified, u.created_at, u.last_login,
              up.first_name, up.last_name, up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          status: 404
        }
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        lastLogin: user.last_login
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change password (authenticated user)
 * @access  Private
 */
router.post('/change-password',
  authMiddleware,
  [
    body('current_password')
      .notEmpty()
      .withMessage('Current password is required'),
    body('new_password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number, and special character')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const { current_password, new_password } = req.body;

    // Verify current password
    const { query } = require('../../database/connection');
    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          status: 404
        }
      });
    }

    const isValidPassword = await authService.verifyPassword(
      current_password,
      result.rows[0].password_hash
    );

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Current password is incorrect',
          status: 401
        }
      });
    }

    // Update password
    const newPasswordHash = await authService.hashPassword(new_password);
    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );

    logger.security('Password changed', { userId, ip: req.ip });

    res.json({
      success: true,
      data: { message: 'Password changed successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

module.exports = router;
