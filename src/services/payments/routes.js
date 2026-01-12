const express = require('express');
const { body, query, validationResult } = require('express-validator');
const paymentService = require('./service');
const { asyncHandler, handleJoiError } = require('../../middleware/errorHandler');
const { authMiddleware, requireRole, requireOwnership, apiKeyAuth } = require('../../middleware/auth');
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
 * @route   POST /api/v1/payments/feature-task
 * @desc    Create payment order for featuring task
 * @access  Private (Company only)
 */
router.post('/feature-task',
  authMiddleware,
  requireRole('company'),
  [
    body('task_id')
      .isUUID()
      .withMessage('Valid task ID is required'),
    body('duration_days')
      .isInt({ min: 1, max: 30 })
      .withMessage('Duration must be between 1 and 30 days'),
    body('payment_method')
      .isIn(['card', 'upi', 'netbanking'])
      .withMessage('Invalid payment method'),
    body('customer_email')
      .optional()
      .isEmail()
      .withMessage('Valid customer email is required'),
    body('customer_contact')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Invalid Indian phone number format')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    const { task_id, duration_days, payment_method, customer_email, customer_contact } = req.body;

    const orderDetails = await paymentService.createFeaturedTaskOrder(
      companyId,
      task_id,
      duration_days,
      {
        payment_method,
        customer_email: customer_email || req.user.email,
        customer_contact
      }
    );

    res.status(201).json({
      success: true,
      data: orderDetails,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/payments/verify
 * @desc    Verify payment after completion
 * @access  Private (Company only)
 */
router.post('/verify',
  authMiddleware,
  requireRole('company'),
  [
    body('razorpay_order_id')
      .notEmpty()
      .withMessage('Razorpay order ID is required'),
    body('razorpay_payment_id')
      .notEmpty()
      .withMessage('Razorpay payment ID is required'),
    body('razorpay_signature')
      .notEmpty()
      .withMessage('Razorpay signature is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const result = await paymentService.verifyPayment(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

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
 * @route   POST /api/v1/payments/webhook
 * @desc    Handle Razorpay webhooks
 * @access  Public (with API key authentication)
 */
router.post('/webhook',
  apiKeyAuth,
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    
    if (!signature) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Razorpay signature is required',
          status: 400
        }
      });
    }

    const result = await paymentService.handleWebhook(req.body, signature);

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  })
);

/**
 * @route   GET /api/v1/payments/history
 * @desc    Get payment history for company
 * @access  Private (Company only)
 */
router.get('/history',
  authMiddleware,
  requireRole('company'),
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
      .isIn(['pending', 'initiated', 'completed', 'failed', 'refunded'])
      .withMessage('Invalid status filter'),
    query('payment_type')
      .optional()
      .isIn(['featured-task', 'premium-analytics', 'subscription'])
      .withMessage('Invalid payment type filter'),
    query('from_date')
      .optional()
      .isISO8601()
      .withMessage('Invalid from date format'),
    query('to_date')
      .optional()
      .isISO8601()
      .withMessage('Invalid to date format')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
      payment_type: req.query.payment_type,
      from_date: req.query.from_date,
      to_date: req.query.to_date
    };

    const result = await paymentService.getPaymentHistory(companyId, filters);

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
 * @route   GET /api/v1/payments/payouts/history
 * @desc    Get payout history for company
 * @access  Private (Company only)
 */
router.get('/payouts/history',
  authMiddleware,
  requireRole('company'),
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
      .isIn(['pending', 'processed', 'failed', 'cancelled'])
      .withMessage('Invalid status filter')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    const { query } = require('../../database/connection');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    let whereConditions = ['company_id = $1'];
    let queryParams = [companyId];
    let paramIndex = 2;

    if (req.query.status) {
      whereConditions.push(`status = $${paramIndex}`);
      queryParams.push(req.query.status);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM payouts WHERE ${whereClause}`;
    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get payouts
    const payoutsQuery = `
      SELECT 
        id, amount, currency, status, payout_period_start, payout_period_end,
        attempted_at, processed_at, failure_reason, created_at
      FROM payouts
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const payoutsResult = await query(payoutsQuery, queryParams);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        payouts: payoutsResult.rows,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_items: total,
          items_per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/payments/payouts/request
 * @desc    Request payout (Admin only)
 * @access  Private (Admin only)
 */
router.post('/payouts/request',
  authMiddleware,
  requireRole('admin'),
  [
    body('company_id')
      .isUUID()
      .withMessage('Valid company ID is required'),
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    body('period_start')
      .isISO8601()
      .withMessage('Valid period start date is required'),
    body('period_end')
      .isISO8601()
      .withMessage('Valid period end date is required')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { company_id, amount, period_start, period_end } = req.body;

    const payout = await paymentService.createPayout(
      company_id,
      parseFloat(amount),
      new Date(period_start),
      new Date(period_end)
    );

    res.status(201).json({
      success: true,
      data: payout,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/payments/payouts/:id/process
 * @desc    Process payout (Admin only)
 * @access  Private (Admin only)
 */
router.post('/payouts/:id/process',
  authMiddleware,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const payoutId = req.params.id;

    const result = await paymentService.processPayout(payoutId);

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
 * @route   GET /api/v1/payments/commission/earnings
 * @desc    Get commission earnings for company
 * @access  Private (Company only)
 */
router.get('/commission/earnings',
  authMiddleware,
  requireRole('company'),
  [
    query('period_start')
      .optional()
      .isISO8601()
      .withMessage('Invalid period start date format'),
    query('period_end')
      .optional()
      .isISO8601()
      .withMessage('Invalid period end date format')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    
    // Default to last 30 days if not provided
    const periodEnd = req.query.period_end ? new Date(req.query.period_end) : new Date();
    const periodStart = req.query.period_start ? new Date(req.query.period_start) : new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

    const earnings = await paymentService.calculateCommissionEarnings(
      companyId,
      periodStart,
      periodEnd
    );

    res.json({
      success: true,
      data: {
        ...earnings,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        commission_rate: parseFloat(process.env.COMMISSION_RATE) || 0.15
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/payments/dashboard
 * @desc    Get payment dashboard for company
 * @access  Private (Company only)
 */
router.get('/dashboard',
  authMiddleware,
  requireRole('company'),
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    const { query } = require('../../database/connection');

    // Get payment statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_payments,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_payments,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as total_spent,
        COALESCE(SUM(CASE WHEN status = 'completed' AND payment_type = 'featured-task' THEN amount ELSE 0 END), 0) as featured_task_spent
      FROM payments
      WHERE company_id = $1
    `;

    const statsResult = await query(statsQuery, [companyId]);
    const stats = statsResult.rows[0];

    // Get recent payments
    const recentPaymentsQuery = `
      SELECT 
        razorpay_order_id, payment_type, amount, status, created_at
      FROM payments
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const recentResult = await query(recentPaymentsQuery, [companyId]);

    // Get pending payouts
    const pendingPayoutsQuery = `
      SELECT 
        COUNT(*) as pending_payouts,
        COALESCE(SUM(amount), 0) as pending_payout_amount
      FROM payouts
      WHERE company_id = $1 AND status = 'pending'
    `;

    const payoutsResult = await query(pendingPayoutsQuery, [companyId]);
    const pendingPayouts = payoutsResult.rows[0];

    res.json({
      success: true,
      data: {
        statistics: {
          total_payments: parseInt(stats.total_payments),
          successful_payments: parseInt(stats.successful_payments),
          failed_payments: parseInt(stats.failed_payments),
          total_spent: parseFloat(stats.total_spent),
          featured_task_spent: parseFloat(stats.featured_task_spent)
        },
        recent_payments: recentResult.rows,
        pending_payouts: {
          count: parseInt(pendingPayouts.pending_payouts),
          amount: parseFloat(pendingPayouts.pending_payout_amount)
        }
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/payments/invoices
 * @desc    Get invoices for company
 * @access  Private (Company only)
 */
router.get('/invoices',
  authMiddleware,
  requireRole('company'),
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    const { query } = require('../../database/connection');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = 'SELECT COUNT(*) as total FROM invoices WHERE company_id = $1';
    const countResult = await query(countQuery, [companyId]);
    const total = parseInt(countResult.rows[0].total);

    // Get invoices
    const invoicesQuery = `
      SELECT 
        id, invoice_number, amount, gst_amount, net_amount,
        from_date, to_date, pdf_url, created_at
      FROM invoices
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const invoicesResult = await query(invoicesQuery, [companyId, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        invoices: invoicesResult.rows,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_items: total,
          items_per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

module.exports = router;
