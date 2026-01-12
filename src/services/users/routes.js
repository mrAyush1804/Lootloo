const express = require('express');
const { body, query, validationResult } = require('express-validator');
const userService = require('./service');
const { asyncHandler, handleJoiError } = require('../../middleware/errorHandler');
const { authMiddleware, requireRole, requireOwnership } = require('../../middleware/auth');
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

/**
 * @route   GET /api/v1/users/profile
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;

    const profile = await userService.getUserProfile(userId);

    res.json({
      success: true,
      data: profile,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   PUT /api/v1/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile',
  authMiddleware,
  [
    body('first_name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('First name must be between 1 and 100 characters'),
    body('last_name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Last name must be between 1 and 100 characters'),
    body('avatar_url')
      .optional()
      .isURL()
      .withMessage('Avatar URL must be a valid URL'),
    body('bio')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Bio must be less than 500 characters'),
    body('city')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('City must be between 2 and 100 characters'),
    body('state')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('State must be between 2 and 100 characters'),
    body('preferences')
      .optional()
      .isObject()
      .withMessage('Preferences must be an object')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;

    const updatedProfile = await userService.updateUserProfile(userId, req.body);

    res.json({
      success: true,
      data: updatedProfile,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/users/rewards
 * @desc    Get user rewards
 * @access  Private (Player only)
 */
router.get('/rewards',
  authMiddleware,
  requireRole('player'),
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('status')
      .optional()
      .isIn(['redeemed', 'unredeemed'])
      .withMessage('Status must be redeemed or unredeemed'),
    query('reward_type')
      .optional()
      .isIn(['discount', 'coupon', 'points', 'cashback'])
      .withMessage('Invalid reward type')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
      reward_type: req.query.reward_type
    };

    const result = await userService.getUserRewards(userId, filters);

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
 * @route   POST /api/v1/users/rewards/:code/redeem
 * @desc    Redeem reward
 * @access  Private (Player only)
 */
router.post('/rewards/:code/redeem',
  authMiddleware,
  requireRole('player'),
  [
    body('code')
      .optional()
      .isAlphanumeric()
      .isLength({ min: 8, max: 20 })
      .withMessage('Invalid reward code format')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const rewardCode = req.params.code || req.body.code;

    if (!rewardCode) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REWARD_CODE',
          message: 'Reward code is required',
          status: 400
        }
      });
    }

    const result = await userService.redeemReward(userId, rewardCode);

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
 * @route   POST /api/v1/users/company/kyc
 * @desc    Submit company KYC
 * @access  Private (Company only)
 */
router.post('/company/kyc',
  authMiddleware,
  requireRole('company'),
  [
    body('company_name')
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('Company name must be between 2 and 255 characters'),
    body('gstin')
      .optional()
      .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
      .withMessage('Invalid GSTIN format'),
    body('pan_number')
      .optional()
      .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
      .withMessage('Invalid PAN format'),
    body('business_category')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Business category must be between 2 and 100 characters'),
    body('website_url')
      .optional()
      .isURL()
      .withMessage('Invalid website URL'),
    body('contact_person')
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('Contact person must be between 2 and 255 characters'),
    body('registered_address')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Registered address must be between 10 and 1000 characters')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;

    const result = await userService.submitCompanyKYC(companyId, req.body);

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
 * @route   GET /api/v1/users/company/dashboard
 * @desc    Get company dashboard
 * @access  Private (Company only)
 */
router.get('/company/dashboard',
  authMiddleware,
  requireRole('company'),
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;

    const dashboard = await userService.getCompanyDashboard(companyId);

    res.json({
      success: true,
      data: dashboard,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/users/company/profile
 * @desc    Get company profile
 * @access  Private (Company only)
 */
router.get('/company/profile',
  authMiddleware,
  requireRole('company'),
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;

    const { query } = require('../../database/connection');
    const result = await query(
      `SELECT 
        u.email, u.created_at, u.is_verified,
        cp.company_name, cp.gstin, cp.pan_number, cp.kyc_status,
        cp.kyc_verified_at, cp.business_category, cp.website_url,
        cp.contact_person, cp.registered_address, cp.logo_url, cp.is_active
       FROM users u
       LEFT JOIN company_profiles cp ON u.id = cp.user_id
       WHERE u.id = $1 AND u.role = 'company'`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'Company profile not found',
          status: 404
        }
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   PUT /api/v1/users/company/profile
 * @desc    Update company profile
 * @access  Private (Company only)
 */
router.put('/company/profile',
  authMiddleware,
  requireRole('company'),
  [
    body('company_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('Company name must be between 2 and 255 characters'),
    body('business_category')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Business category must be between 2 and 100 characters'),
    body('website_url')
      .optional()
      .isURL()
      .withMessage('Invalid website URL'),
    body('contact_person')
      .optional()
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('Contact person must be between 2 and 255 characters'),
    body('registered_address')
      .optional()
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Registered address must be between 10 and 1000 characters'),
    body('logo_url')
      .optional()
      .isURL()
      .withMessage('Logo URL must be a valid URL')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;

    const { query } = require('../../database/connection');
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // Build update query
    const allowedUpdates = [
      'company_name', 'business_category', 'website_url', 
      'contact_person', 'registered_address', 'logo_url'
    ];

    for (const [key, value] of Object.entries(req.body)) {
      if (allowedUpdates.includes(key)) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value.trim());
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_VALID_FIELDS',
          message: 'No valid fields to update',
          status: 400
        }
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(companyId);

    const updateQuery = `
      UPDATE company_profiles 
      SET ${updates.join(', ')}
      WHERE user_id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'COMPANY_PROFILE_NOT_FOUND',
          message: 'Company profile not found',
          status: 404
        }
      });
    }

    logger.business('Company profile updated', {
      companyId,
      updatedFields: Object.keys(req.body)
    });

    res.json({
      success: true,
      data: result.rows[0],
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/users/stats
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const userRole = req.user.role;

    const { query } = require('../../database/connection');
    let stats = {};

    if (userRole === 'player') {
      // Player statistics
      const playerStatsQuery = `
        SELECT 
          COUNT(DISTINCT ta.task_id) as tasks_attempted,
          COUNT(ta.id) as total_attempts,
          COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts,
          ROUND(
            COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
            NULLIF(COUNT(ta.id), 0) * 100, 2
          ) as success_rate,
          AVG(ta.time_taken_seconds) as avg_completion_time,
          COUNT(ur.id) as total_rewards,
          COUNT(CASE WHEN ur.is_redeemed = false THEN 1 END) as unredeemed_rewards,
          COALESCE(SUM(ur.reward_value), 0) as total_rewards_value
        FROM users u
        LEFT JOIN task_attempts ta ON u.id = ta.user_id
        LEFT JOIN user_rewards ur ON u.id = ur.user_id
        WHERE u.id = $1
      `;

      const result = await query(playerStatsQuery, [userId]);
      stats = result.rows[0];

    } else if (userRole === 'company') {
      // Company statistics (simplified version of dashboard)
      const companyStatsQuery = `
        SELECT 
          COUNT(DISTINCT t.id) as total_tasks,
          COUNT(DISTINCT CASE WHEN t.status = 'active' THEN t.id END) as active_tasks,
          COUNT(ta.id) as total_attempts,
          COUNT(CASE WHEN ta.is_successful THEN 1 END) as total_conversions,
          ROUND(
            COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
            NULLIF(COUNT(ta.id), 0) * 100, 2
          ) as conversion_rate
        FROM users u
        LEFT JOIN tasks t ON u.id = t.company_id
        LEFT JOIN task_attempts ta ON t.id = ta.task_id
        WHERE u.id = $1
      `;

      const result = await query(companyStatsQuery, [userId]);
      stats = result.rows[0];
    }

    res.json({
      success: true,
      data: {
        role: userRole,
        ...stats
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   DELETE /api/v1/users/account
 * @desc    Delete user account (soft delete)
 * @access  Private
 */
router.delete('/account',
  authMiddleware,
  [
    body('password')
      .notEmpty()
      .withMessage('Password is required for account deletion')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const { password } = req.body;

    // Verify password
    const { query } = require('../../database/connection');
    const userResult = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          status: 404
        }
      });
    }

    // Verify password (using authService)
    const authService = require('../auth/service');
    const isValidPassword = await authService.verifyPassword(
      password,
      userResult.rows[0].password_hash
    );

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Invalid password',
          status: 401
        }
      });
    }

    // Soft delete user (deactivate account)
    await query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );

    logger.security('User account deleted', {
      userId,
      ip: req.ip
    });

    res.json({
      success: true,
      data: { message: 'Account deactivated successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

module.exports = router;
