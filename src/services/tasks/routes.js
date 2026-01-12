const express = require('express');
const { body, query, validationResult } = require('express-validator');
const multer = require('multer');
const taskService = require('./service');
const { asyncHandler, handleJoiError } = require('../../middleware/errorHandler');
const { authMiddleware, requireRole, requireOwnership } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

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
 * @route   POST /api/v1/tasks
 * @desc    Create a new task
 * @access  Private (Company only)
 */
router.post('/',
  authMiddleware,
  requireRole('company'),
  upload.single('image_file'),
  [
    body('title')
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Title must be between 3 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Description must be less than 1000 characters'),
    body('task_type')
      .isIn(['image-puzzle', 'spot-diff', 'speed-challenge', 'meme', 'logic'])
      .withMessage('Invalid task type'),
    body('difficulty')
      .isIn(['easy', 'medium', 'hard', 'expert'])
      .withMessage('Invalid difficulty level'),
    body('reward_type')
      .isIn(['discount', 'coupon', 'points', 'cashback'])
      .withMessage('Invalid reward type'),
    body('reward_value')
      .isFloat({ min: 0.01 })
      .withMessage('Reward value must be greater than 0'),
    body('reward_description')
      .trim()
      .isLength({ min: 10, max: 255 })
      .withMessage('Reward description must be between 10 and 255 characters')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    
    const taskData = {
      ...req.body,
      image_file: req.file ? req.file.buffer.toString('base64') : null
    };

    const task = await taskService.createTask(companyId, taskData);

    res.status(201).json({
      success: true,
      data: task,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/tasks/list
 * @desc    List tasks with filtering and pagination
 * @access  Public
 */
router.get('/list',
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('difficulty')
      .optional()
      .isIn(['easy', 'medium', 'hard', 'expert'])
      .withMessage('Invalid difficulty filter'),
    query('task_type')
      .optional()
      .isIn(['image-puzzle', 'spot-diff', 'speed-challenge', 'meme', 'logic'])
      .withMessage('Invalid task type filter'),
    query('sort_by')
      .optional()
      .isIn(['created_at', 'title', 'difficulty', 'reward_value', 'conversion_rate'])
      .withMessage('Invalid sort field'),
    query('sort_order')
      .optional()
      .isIn(['ASC', 'DESC'])
      .withMessage('Sort order must be ASC or DESC'),
    query('city')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('City must be between 2 and 100 characters'),
    query('featured_only')
      .optional()
      .isBoolean()
      .withMessage('featured_only must be boolean')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      difficulty: req.query.difficulty,
      task_type: req.query.task_type,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      city: req.query.city,
      featured_only: req.query.featured_only === 'true'
    };

    const result = await taskService.listTasks(filters);

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
 * @route   GET /api/v1/tasks/:id
 * @desc    Get task details
 * @access  Public (with optional auth for attempt tracking)
 */
router.get('/:id',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user?.sub || null;

    const task = await taskService.getTask(taskId, userId);

    res.json({
      success: true,
      data: task,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   PUT /api/v1/tasks/:id
 * @desc    Update task
 * @access  Private (Company only, owner only)
 */
router.put('/:id',
  authMiddleware,
  requireRole('company'),
  requireOwnership('task'),
  [
    body('title')
      .optional()
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Title must be between 3 and 100 characters'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Description must be less than 1000 characters'),
    body('difficulty')
      .optional()
      .isIn(['easy', 'medium', 'hard', 'expert'])
      .withMessage('Invalid difficulty level'),
    body('reward_value')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('Reward value must be greater than 0'),
    body('reward_description')
      .optional()
      .trim()
      .isLength({ min: 10, max: 255 })
      .withMessage('Reward description must be between 10 and 255 characters')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const companyId = req.user.sub;

    const updatedTask = await taskService.updateTask(taskId, companyId, req.body);

    res.json({
      success: true,
      data: updatedTask,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   DELETE /api/v1/tasks/:id
 * @desc    Delete task
 * @access  Private (Company only, owner only)
 */
router.delete('/:id',
  authMiddleware,
  requireRole('company'),
  requireOwnership('task'),
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const companyId = req.user.sub;

    await taskService.deleteTask(taskId, companyId);

    res.json({
      success: true,
      data: { message: 'Task deleted successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/tasks/:id/publish
 * @desc    Publish task
 * @access  Private (Company only, owner only)
 */
router.post('/:id/publish',
  authMiddleware,
  requireRole('company'),
  requireOwnership('task'),
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const companyId = req.user.sub;

    const publishedTask = await taskService.publishTask(taskId, companyId);

    res.json({
      success: true,
      data: publishedTask,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   POST /api/v1/tasks/:id/feature
 * @desc    Feature task (paid promotion)
 * @access  Private (Company only, owner only)
 */
router.post('/:id/feature',
  authMiddleware,
  requireRole('company'),
  requireOwnership('task'),
  [
    body('duration_days')
      .isInt({ min: 1, max: 30 })
      .withMessage('Duration must be between 1 and 30 days'),
    body('payment_method')
      .optional()
      .isIn(['card', 'upi', 'netbanking'])
      .withMessage('Invalid payment method')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const companyId = req.user.sub;
    const { duration_days } = req.body;

    const result = await taskService.featureTask(taskId, companyId, duration_days);

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
 * @route   POST /api/v1/tasks/:id/attempt
 * @desc    Record task attempt
 * @access  Private (Player only)
 */
router.post('/:id/attempt',
  authMiddleware,
  requireRole('player'),
  [
    body('is_successful')
      .isBoolean()
      .withMessage('is_successful must be boolean'),
    body('time_taken_seconds')
      .isInt({ min: 1 })
      .withMessage('time_taken_seconds must be a positive integer'),
    body('difficulty_multiplier')
      .optional()
      .isFloat({ min: 0.5, max: 3.0 })
      .withMessage('difficulty_multiplier must be between 0.5 and 3.0')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.sub;

    const attempt = await taskService.recordAttempt(taskId, userId, req.body);

    res.status(201).json({
      success: true,
      data: attempt,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

/**
 * @route   GET /api/v1/tasks/my-tasks
 * @desc    Get company's tasks
 * @access  Private (Company only)
 */
router.get('/my-tasks',
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
      .isIn(['draft', 'active', 'expired'])
      .withMessage('Invalid status filter')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const companyId = req.user.sub;
    
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      company_id: companyId,
      status: req.query.status
    };

    const result = await taskService.listTasks(filters);

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
 * @route   GET /api/v1/tasks/analytics/:id
 * @desc    Get task analytics (owner only)
 * @access  Private (Company only, owner only)
 */
router.get('/analytics/:id',
  authMiddleware,
  requireRole('company'),
  requireOwnership('task'),
  asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const companyId = req.user.sub;

    // Get detailed analytics for the task
    const { query } = require('../../database/connection');
    
    const analyticsQuery = `
      SELECT 
        t.*,
        COUNT(ta.id) as total_attempts,
        COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts,
        ROUND(
          (COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
           NULLIF(COUNT(ta.id), 0)) * 100, 2
        ) as conversion_rate,
        AVG(ta.time_taken_seconds) as avg_completion_time,
        MIN(ta.time_taken_seconds) as fastest_completion_time,
        MAX(ta.time_taken_seconds) as slowest_completion_time
      FROM tasks t
      LEFT JOIN task_attempts ta ON t.id = ta.task_id
      WHERE t.id = $1 AND t.company_id = $2
      GROUP BY t.id
    `;

    const result = await query(analyticsQuery, [taskId, companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found or access denied',
          status: 404
        }
      });
    }

    const analytics = result.rows[0];

    // Get daily attempts for the last 30 days
    const dailyQuery = `
      SELECT 
        DATE(ta.created_at) as date,
        COUNT(*) as attempts,
        COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts
      FROM task_attempts ta
      WHERE ta.task_id = $1 
        AND ta.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(ta.created_at)
      ORDER BY date DESC
    `;

    const dailyResult = await query(dailyQuery, [taskId]);

    res.json({
      success: true,
      data: {
        ...analytics,
        daily_stats: dailyResult.rows
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  })
);

module.exports = router;
