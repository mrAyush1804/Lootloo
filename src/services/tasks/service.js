const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../database/connection');
const { cacheService } = require('../../cache/redis');
const puzzleGenerator = require('./puzzleGenerator');
const logger = require('../../utils/logger');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  GoneError
} = require('../../middleware/errorHandler');

class TaskService {
  /**
   * Create a new task
   * @param {string} companyId - Company ID
   * @param {Object} taskData - Task data
   * @returns {Object} Created task
   */
  async createTask(companyId, taskData) {
    const {
      title,
      description,
      task_type,
      difficulty,
      reward_type,
      reward_value,
      reward_description,
      image_file,
      puzzle_config
    } = taskData;

    // Validate inputs
    this.validateTaskData(taskData);

    // Check if task title already exists for this company
    const existingTask = await query(
      'SELECT id FROM tasks WHERE company_id = $1 AND LOWER(title) = LOWER($2)',
      [companyId, title.trim()]
    );

    if (existingTask.rows.length > 0) {
      throw new ConflictError('Task with this title already exists for your company');
    }

    let imageUrl = null;
    let generatedPuzzleConfig = null;

    // Process image if provided
    if (image_file) {
      try {
        // Generate puzzle from image
        const gridSize = this.getGridSizeFromDifficulty(difficulty);
        generatedPuzzleConfig = await puzzleGenerator.generateImagePuzzle(
          Buffer.from(image_file, 'base64'),
          gridSize
        );
        imageUrl = generatedPuzzleConfig.image_url;
      } catch (error) {
        logger.error('Failed to process task image:', error);
        throw new ValidationError('Failed to process image. Please ensure it\'s a valid JPEG/PNG file under 5MB');
      }
    }

    // Create task in database
    const result = await query(
      `INSERT INTO tasks (
        company_id, title, description, task_type, difficulty,
        reward_type, reward_value, reward_description, image_url,
        puzzle_config, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        companyId,
        title.trim(),
        description?.trim() || null,
        task_type,
        difficulty,
        reward_type,
        parseFloat(reward_value),
        reward_description.trim(),
        imageUrl,
        generatedPuzzleConfig ? JSON.stringify(generatedPuzzleConfig) : null,
        'draft'
      ]
    );

    const task = result.rows[0];

    // Cache the task
    await cacheService.set(`task:${task.id}`, task, 300);

    logger.business('Task created', {
      taskId: task.id,
      companyId,
      title: task.title,
      taskType: task.task_type,
      difficulty: task.difficulty
    });

    return task;
  }

  /**
   * Get task by ID
   * @param {string} taskId - Task ID
   * @param {string} userId - User ID (for attempt tracking)
   * @returns {Object} Task details
   */
  async getTask(taskId, userId = null) {
    // Try cache first
    let task = await cacheService.get(`task:${taskId}`);

    if (!task) {
      // Get from database
      const result = await query(
        `SELECT t.*, u.email as company_email, cp.company_name,
                COUNT(ta.id) as total_attempts,
                COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts
         FROM tasks t
         JOIN users u ON t.company_id = u.id
         LEFT JOIN company_profiles cp ON u.id = cp.user_id
         LEFT JOIN task_attempts ta ON t.id = ta.task_id
         WHERE t.id = $1
         GROUP BY t.id, u.email, cp.company_name`,
        [taskId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Task not found');
      }

      task = result.rows[0];

      // Cache the task
      await cacheService.set(`task:${taskId}`, task, 300);
    }

    // Check if user has already attempted this task
    if (userId) {
      const attemptResult = await query(
        'SELECT id, is_successful, time_taken_seconds FROM task_attempts WHERE task_id = $1 AND user_id = $2',
        [taskId, userId]
      );

      task.user_attempt = attemptResult.rows[0] || null;
    }

    // Don't expose puzzle solution to users
    if (task.puzzle_config) {
      const puzzleConfig = JSON.parse(task.puzzle_config);
      delete puzzleConfig.correct_solution;
      task.puzzle_config = puzzleConfig;
    }

    return task;
  }

  /**
   * List tasks with filtering and pagination
   * @param {Object} filters - Filter options
   * @returns {Object} Tasks list with pagination
   */
  async listTasks(filters = {}) {
    const {
      page = 1,
      limit = 20,
      difficulty,
      task_type,
      sort_by = 'created_at',
      sort_order = 'DESC',
      city,
      featured_only = false,
      company_id
    } = filters;

    const offset = (page - 1) * limit;
    let whereConditions = ['t.status = $1'];
    let queryParams = ['active'];
    let paramIndex = 2;

    // Add filters
    if (difficulty) {
      whereConditions.push(`t.difficulty = $${paramIndex}`);
      queryParams.push(difficulty);
      paramIndex++;
    }

    if (task_type) {
      whereConditions.push(`t.task_type = $${paramIndex}`);
      queryParams.push(task_type);
      paramIndex++;
    }

    if (city) {
      whereConditions.push(`cp.city ILIKE $${paramIndex}`);
      queryParams.push(`%${city}%`);
      paramIndex++;
    }

    if (featured_only) {
      whereConditions.push(`t.is_featured = true AND t.featured_until > CURRENT_TIMESTAMP`);
    }

    if (company_id) {
      whereConditions.push(`t.company_id = $${paramIndex}`);
      queryParams.push(company_id);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Validate sort field
    const validSortFields = ['created_at', 'title', 'difficulty', 'reward_value', 'conversion_rate'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM tasks t
      LEFT JOIN company_profiles cp ON t.company_id = cp.user_id
      WHERE ${whereClause}
    `;

    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get tasks
    const tasksQuery = `
      SELECT 
        t.id, t.title, t.description, t.task_type, t.difficulty,
        t.reward_type, t.reward_value, t.reward_description, t.image_url,
        t.is_featured, t.featured_until, t.attempt_count, t.conversion_count,
        t.conversion_rate, t.created_at, t.expires_at,
        cp.company_name, cp.city,
        u.email as company_email
      FROM tasks t
      JOIN users u ON t.company_id = u.id
      LEFT JOIN company_profiles cp ON u.id = cp.user_id
      WHERE ${whereClause}
      ORDER BY t.${sortField} ${sortDirection}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const tasksResult = await query(tasksQuery, queryParams);

    const totalPages = Math.ceil(total / limit);

    return {
      tasks: tasksResult.rows,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_items: total,
        items_per_page: limit,
        has_next: page < totalPages,
        has_prev: page > 1
      }
    };
  }

  /**
   * Update task
   * @param {string} taskId - Task ID
   * @param {string} companyId - Company ID (for ownership check)
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated task
   */
  async updateTask(taskId, companyId, updateData) {
    // Check if task exists and belongs to company
    const existingTask = await query(
      'SELECT * FROM tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId]
    );

    if (existingTask.rows.length === 0) {
      throw new NotFoundError('Task not found or access denied');
    }

    const task = existingTask.rows[0];

    // Check if task can be edited
    if (task.status === 'active') {
      throw new ForbiddenError('Cannot edit published task');
    }

    const allowedUpdates = ['title', 'description', 'difficulty', 'reward_value', 'reward_description'];
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // Build update query
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedUpdates.includes(key)) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    // Add updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(taskId, companyId);

    const updateQuery = `
      UPDATE tasks 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await query(updateQuery, values);
    const updatedTask = result.rows[0];

    // Clear cache
    await cacheService.del(`task:${taskId}`);

    logger.business('Task updated', {
      taskId,
      companyId,
      updates: Object.keys(updateData)
    });

    return updatedTask;
  }

  /**
   * Delete task
   * @param {string} taskId - Task ID
   * @param {string} companyId - Company ID (for ownership check)
   * @returns {boolean} Success status
   */
  async deleteTask(taskId, companyId) {
    // Get task details for cleanup
    const taskResult = await query(
      'SELECT * FROM tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found or access denied');
    }

    const task = taskResult.rows[0];

    // Delete task in transaction
    await withTransaction(async (client) => {
      // Delete related records
      await client.query('DELETE FROM task_attempts WHERE task_id = $1', [taskId]);
      await client.query('DELETE FROM user_rewards WHERE task_id = $1', [taskId]);
      
      // Delete task
      await client.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    });

    // Clean up puzzle assets if they exist
    if (task.image_url && task.puzzle_config) {
      try {
        const puzzleConfig = JSON.parse(task.puzzle_config);
        await puzzleGenerator.deletePuzzleAssets(task.image_url);
      } catch (error) {
        logger.error('Failed to cleanup puzzle assets:', error);
      }
    }

    // Clear cache
    await cacheService.del(`task:${taskId}`);

    logger.business('Task deleted', {
      taskId,
      companyId,
      title: task.title
    });

    return true;
  }

  /**
   * Publish task
   * @param {string} taskId - Task ID
   * @param {string} companyId - Company ID
   * @returns {Object} Published task
   */
  async publishTask(taskId, companyId) {
    const taskResult = await query(
      'SELECT * FROM tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found or access denied');
    }

    const task = taskResult.rows[0];

    if (task.status !== 'draft') {
      throw new ForbiddenError('Only draft tasks can be published');
    }

    if (!task.image_url) {
      throw new ValidationError('Task must have an image to be published');
    }

    if (task.reward_value <= 0) {
      throw new ValidationError('Task must have a valid reward value');
    }

    // Update task status
    const result = await query(
      `UPDATE tasks 
       SET status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [taskId, companyId]
    );

    const publishedTask = result.rows[0];

    // Clear cache
    await cacheService.del(`task:${taskId}`);

    logger.business('Task published', {
      taskId,
      companyId,
      title: task.title
    });

    return publishedTask;
  }

  /**
   * Feature task (paid promotion)
   * @param {string} taskId - Task ID
   * @param {string} companyId - Company ID
   * @param {number} durationDays - Duration in days
   * @returns {Object} Featured task details
   */
  async featureTask(taskId, companyId, durationDays) {
    const taskResult = await query(
      'SELECT * FROM tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found or access denied');
    }

    const task = taskResult.rows[0];

    if (task.status !== 'active') {
      throw new ForbiddenError('Only active tasks can be featured');
    }

    // Calculate cost
    const costPerDay = parseFloat(process.env.FEATURED_TASK_COST_PER_DAY) || 99;
    const totalCost = costPerDay * durationDays;

    // Update task with featured status
    const featuredUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    
    const result = await query(
      `UPDATE tasks 
       SET is_featured = true, featured_until = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [featuredUntil, taskId, companyId]
    );

    const featuredTask = result.rows[0];

    // Clear cache
    await cacheService.del(`task:${taskId}`);

    logger.business('Task featured', {
      taskId,
      companyId,
      durationDays,
      cost: totalCost,
      featuredUntil
    });

    return {
      task: featuredTask,
      cost: totalCost,
      featured_until: featuredUntil
    };
  }

  /**
   * Record task attempt
   * @param {string} taskId - Task ID
   * @param {string} userId - User ID
   * @param {Object} attemptData - Attempt data
   * @returns {Object} Attempt result
   */
  async recordAttempt(taskId, userId, attemptData) {
    const { is_successful, time_taken_seconds, difficulty_multiplier } = attemptData;

    // Check if user has already attempted this task
    const existingAttempt = await query(
      'SELECT id FROM task_attempts WHERE task_id = $1 AND user_id = $2',
      [taskId, userId]
    );

    if (existingAttempt.rows.length > 0) {
      throw new ConflictError('You have already attempted this task');
    }

    // Get task details
    const taskResult = await query(
      'SELECT * FROM tasks WHERE id = $1 AND status = $2',
      [taskId, 'active']
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found or not active');
    }

    const task = taskResult.rows[0];

    // Check if task has expired
    if (task.expires_at && new Date() > new Date(task.expires_at)) {
      throw new GoneError('Task has expired');
    }

    // Record attempt
    const result = await query(
      `INSERT INTO task_attempts (
        task_id, user_id, started_at, completed_at, 
        time_taken_seconds, is_successful, difficulty_multiplier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        taskId,
        userId,
        new Date(Date.now() - (time_taken_seconds * 1000)),
        new Date(),
        time_taken_seconds,
        is_successful,
        difficulty_multiplier || 1.0
      ]
    );

    const attempt = result.rows[0];

    // Update task statistics
    await query(
      `UPDATE tasks 
       SET attempt_count = attempt_count + 1,
           conversion_count = CASE WHEN $1 THEN conversion_count + 1 ELSE conversion_count END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [is_successful, taskId]
    );

    // Clear cache
    await cacheService.del(`task:${taskId}`);

    logger.business('Task attempt recorded', {
      taskId,
      userId,
      isSuccessful: is_successful,
      timeTaken: time_taken_seconds
    });

    return attempt;
  }

  /**
   * Validate task data
   * @param {Object} taskData - Task data to validate
   */
  validateTaskData(taskData) {
    const {
      title,
      description,
      task_type,
      difficulty,
      reward_type,
      reward_value,
      reward_description
    } = taskData;

    if (!title || title.trim().length < 3 || title.trim().length > 100) {
      throw new ValidationError('Title must be between 3 and 100 characters');
    }

    if (description && description.length > 1000) {
      throw new ValidationError('Description must be less than 1000 characters');
    }

    const validTaskTypes = ['image-puzzle', 'spot-diff', 'speed-challenge', 'meme', 'logic'];
    if (!validTaskTypes.includes(task_type)) {
      throw new ValidationError('Invalid task type');
    }

    const validDifficulties = ['easy', 'medium', 'hard', 'expert'];
    if (!validDifficulties.includes(difficulty)) {
      throw new ValidationError('Invalid difficulty level');
    }

    const validRewardTypes = ['discount', 'coupon', 'points', 'cashback'];
    if (!validRewardTypes.includes(reward_type)) {
      throw new ValidationError('Invalid reward type');
    }

    const rewardValue = parseFloat(reward_value);
    if (isNaN(rewardValue) || rewardValue <= 0) {
      throw new ValidationError('Reward value must be a positive number');
    }

    const maxReward = parseFloat(process.env.MAX_TASK_REWARD_VALUE) || 10000;
    if (rewardValue > maxReward) {
      throw new ValidationError(`Reward value cannot exceed ${maxReward}`);
    }

    if (!reward_description || reward_description.trim().length < 10 || reward_description.trim().length > 255) {
      throw new ValidationError('Reward description must be between 10 and 255 characters');
    }
  }

  /**
   * Get grid size from difficulty
   * @param {string} difficulty - Difficulty level
   * @returns {number} Grid size
   */
  getGridSizeFromDifficulty(difficulty) {
    const gridSizes = {
      easy: 9,    // 3x3
      medium: 16, // 4x4
      hard: 25,   // 5x5
      expert: 25  // 5x5 (same as hard but with more complex images)
    };

    return gridSizes[difficulty] || 16;
  }
}

module.exports = new TaskService();
