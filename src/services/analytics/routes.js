const express = require('express');
const { query, validationResult } = require('express-validator');
const analyticsService = require('./service');
const { asyncHandler, handleJoiError } = require('../../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../../middleware/auth');

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
 * @route   POST /api/v1/analytics/track
 * @desc    Track custom analytics event
 * @access  Private
 */
router.post('/track',
  authMiddleware,
  [
    query('event_type')
      .notEmpty()
      .withMessage('Event type is required'),
    query('task_id')
      .optional()
      .isUUID()
      .withMessage('Valid task ID is required'),
    query('company_id')
      .optional()
      .isUUID()
      .withMessage('Valid company ID is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = req.user.sub;
    const { event_type, task_id, company_id } = req.query;
    const metadata = req.body;

    await analyticsService.trackEvent(event_type, {
      user_id: userId,
      task_id,
      company_id,
      metadata
    });

    res.json({
      success: true,
      data: { message: 'Event tracked successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/analytics/company/:id/metrics
 * @desc    Get company analytics metrics
 * @access  Private (Company owner or Admin)
 */
router.get('/company/:id/metrics',
  authMiddleware,
  [
    query('period_days')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Period must be between 1 and 365 days')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.params.id;
    const periodDays = parseInt(req.query.period_days) || 30;

    // Check authorization
    if (req.user.role !== 'admin' && req.user.sub !== companyId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          status: 403
        }
      });
    }

    const metrics = await analyticsService.getCompanyMetrics(companyId, periodDays);

    res.json({
      success: true,
      data: metrics,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/analytics/global/metrics
 * @desc    Get global platform metrics
 * @access  Private (Admin only)
 */
router.get('/global/metrics',
  authMiddleware,
  requireRole('admin'),
  [
    query('period_days')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Period must be between 1 and 365 days')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const periodDays = parseInt(req.query.period_days) || 30;

    const metrics = await analyticsService.getGlobalMetrics(periodDays);

    res.json({
      success: true,
      data: metrics,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

module.exports = router;
