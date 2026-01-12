const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../database/connection');
const { cacheService } = require('../../cache/redis');
const logger = require('../../utils/logger');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  GoneError
} = require('../../middleware/errorHandler');

class UserService {
  /**
   * Get user profile
   * @param {string} userId - User ID
   * @returns {Object} User profile data
   */
  async getUserProfile(userId) {
    // Try cache first
    const cacheKey = `user_profile:${userId}`;
    let profile = await cacheService.get(cacheKey);

    if (!profile) {
      // Get user and profile data
      const result = await query(
        `SELECT 
          u.id, u.email, u.role, u.is_verified, u.created_at, u.last_login,
          up.first_name, up.last_name, up.avatar_url, up.bio, up.city, up.state,
          up.preferences
         FROM users u
         LEFT JOIN user_profiles up ON u.id = up.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }

      profile = result.rows[0];

      // Parse preferences if they exist
      if (profile.preferences) {
        profile.preferences = JSON.parse(profile.preferences);
      }

      // Cache for 5 minutes
      await cacheService.set(cacheKey, profile, 300);
    }

    return profile;
  }

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated profile
   */
  async updateUserProfile(userId, updateData) {
    const {
      first_name,
      last_name,
      avatar_url,
      bio,
      city,
      state,
      preferences
    } = updateData;

    // Validate inputs
    this.validateProfileData(updateData);

    // Check if profile exists
    const existingProfile = await query(
      'SELECT id FROM user_profiles WHERE user_id = $1',
      [userId]
    );

    let result;
    
    if (existingProfile.rows.length === 0) {
      // Create new profile
      result = await query(
        `INSERT INTO user_profiles (
          user_id, first_name, last_name, avatar_url, bio, city, state, preferences
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          userId,
          first_name?.trim(),
          last_name?.trim(),
          avatar_url?.trim(),
          bio?.trim(),
          city?.trim(),
          state?.trim(),
          preferences ? JSON.stringify(preferences) : null
        ]
      );
    } else {
      // Update existing profile
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (first_name !== undefined) {
        updates.push(`first_name = $${paramIndex}`);
        values.push(first_name.trim());
        paramIndex++;
      }

      if (last_name !== undefined) {
        updates.push(`last_name = $${paramIndex}`);
        values.push(last_name.trim());
        paramIndex++;
      }

      if (avatar_url !== undefined) {
        updates.push(`avatar_url = $${paramIndex}`);
        values.push(avatar_url.trim());
        paramIndex++;
      }

      if (bio !== undefined) {
        updates.push(`bio = $${paramIndex}`);
        values.push(bio.trim());
        paramIndex++;
      }

      if (city !== undefined) {
        updates.push(`city = $${paramIndex}`);
        values.push(city.trim());
        paramIndex++;
      }

      if (state !== undefined) {
        updates.push(`state = $${paramIndex}`);
        values.push(state.trim());
        paramIndex++;
      }

      if (preferences !== undefined) {
        updates.push(`preferences = $${paramIndex}`);
        values.push(JSON.stringify(preferences));
        paramIndex++;
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(userId);

      const updateQuery = `
        UPDATE user_profiles 
        SET ${updates.join(', ')}
        WHERE user_id = $${paramIndex}
        RETURNING *
      `;

      result = await query(updateQuery, values);
    }

    // Clear cache
    await cacheService.del(`user_profile:${userId}`);

    logger.business('User profile updated', {
      userId,
      updatedFields: Object.keys(updateData)
    });

    return result.rows[0];
  }

  /**
   * Get user rewards
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   * @returns {Object} Rewards with pagination
   */
  async getUserRewards(userId, filters = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      reward_type
    } = filters;

    const offset = (page - 1) * limit;
    let whereConditions = ['ur.user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    // Add filters
    if (status === 'redeemed') {
      whereConditions.push('ur.is_redeemed = true');
    } else if (status === 'unredeemed') {
      whereConditions.push('ur.is_redeemed = false');
    }

    if (reward_type) {
      whereConditions.push(`ur.reward_type = $${paramIndex}`);
      queryParams.push(reward_type);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM user_rewards ur
      WHERE ${whereClause}
    `;

    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get rewards with task details
    const rewardsQuery = `
      SELECT 
        ur.id, ur.reward_code, ur.reward_type, ur.reward_value,
        ur.is_redeemed, ur.redeemed_at, ur.expires_at, ur.created_at,
        t.title as task_title, t.company_id,
        cp.company_name, cp.logo_url as company_logo
      FROM user_rewards ur
      JOIN tasks t ON ur.task_id = t.id
      JOIN users u ON t.company_id = u.id
      LEFT JOIN company_profiles cp ON u.id = cp.user_id
      WHERE ${whereClause}
      ORDER BY ur.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const rewardsResult = await query(rewardsQuery, queryParams);

    // Calculate summary stats
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_rewards,
        COUNT(CASE WHEN ur.is_redeemed = false THEN 1 END) as unredeemed_count,
        COUNT(CASE WHEN ur.is_redeemed = true THEN 1 END) as redeemed_count,
        COALESCE(SUM(CASE WHEN ur.is_redeemed = false THEN ur.reward_value ELSE 0 END), 0) as total_unredeemed_value,
        COALESCE(SUM(ur.reward_value), 0) as total_rewards_value
      FROM user_rewards ur
      WHERE ur.user_id = $1
    `;

    const summaryResult = await query(summaryQuery, [userId]);
    const summary = summaryResult.rows[0];

    const totalPages = Math.ceil(total / limit);

    return {
      rewards: rewardsResult.rows,
      summary: {
        total_rewards: parseInt(summary.total_rewards),
        unredeemed_count: parseInt(summary.unredeemed_count),
        redeemed_count: parseInt(summary.redeemed_count),
        total_unredeemed_value: parseFloat(summary.total_unredeemed_value),
        total_rewards_value: parseFloat(summary.total_rewards_value)
      },
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
   * Create reward for user
   * @param {string} userId - User ID
   * @param {string} taskId - Task ID
   * @returns {Object} Created reward
   */
  async createReward(userId, taskId) {
    // Check if user already has reward for this task
    const existingReward = await query(
      'SELECT id FROM user_rewards WHERE user_id = $1 AND task_id = $2',
      [userId, taskId]
    );

    if (existingReward.rows.length > 0) {
      throw new ConflictError('Reward already exists for this task');
    }

    // Get task details
    const taskResult = await query(
      'SELECT reward_type, reward_value, reward_description FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found');
    }

    const task = taskResult.rows[0];

    // Generate unique reward code
    const rewardCode = this.generateRewardCode();

    // Calculate expiry date
    const expiryDays = parseInt(process.env.REWARD_EXPIRY_DAYS) || 30;
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    // Create reward
    const result = await query(
      `INSERT INTO user_rewards (
        user_id, task_id, reward_code, reward_type, reward_value, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [userId, taskId, rewardCode, task.reward_type, task.reward_value, expiresAt]
    );

    const reward = result.rows[0];

    logger.business('Reward created', {
      rewardId: reward.id,
      userId,
      taskId,
      rewardCode,
      rewardValue: reward.reward_value,
      rewardType: reward.reward_type
    });

    return reward;
  }

  /**
   * Redeem reward
   * @param {string} userId - User ID
   * @param {string} rewardCode - Reward code
   * @returns {Object} Redemption details
   */
  async redeemReward(userId, rewardCode) {
    // Get reward details
    const result = await query(
      `SELECT 
        ur.*, t.title as task_title, t.company_id,
        cp.company_name, cp.contact_person, cp.website_url, cp.registered_address
      FROM user_rewards ur
      JOIN tasks t ON ur.task_id = t.id
      JOIN users u ON t.company_id = u.id
      LEFT JOIN company_profiles cp ON u.id = cp.user_id
      WHERE ur.reward_code = $1 AND ur.user_id = $2`,
      [rewardCode, userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Reward not found');
    }

    const reward = result.rows[0];

    // Check if already redeemed
    if (reward.is_redeemed) {
      throw new ConflictError('Reward has already been redeemed');
    }

    // Check if expired
    if (new Date() > new Date(reward.expires_at)) {
      throw new GoneError('Reward has expired');
    }

    // Mark as redeemed
    await query(
      'UPDATE user_rewards SET is_redeemed = true, redeemed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [reward.id]
    );

    logger.business('Reward redeemed', {
      rewardId: reward.id,
      userId,
      rewardCode,
      rewardValue: reward.reward_value,
      companyId: reward.company_id
    });

    return {
      reward: {
        id: reward.id,
        reward_code: reward.reward_code,
        reward_type: reward.reward_type,
        reward_value: reward.reward_value,
        redeemed_at: new Date().toISOString()
      },
      company_details: {
        company_name: reward.company_name,
        contact_person: reward.contact_person,
        website_url: reward.website_url,
        registered_address: reward.registered_address
      },
      how_to_redeem: this.getRedemptionInstructions(reward.reward_type)
    };
  }

  /**
   * Get company dashboard data
   * @param {string} companyId - Company ID
   * @returns {Object} Dashboard data
   */
  async getCompanyDashboard(companyId) {
    // Get company info
    const companyResult = await query(
      `SELECT u.email, u.created_at,
              cp.company_name, cp.logo_url, cp.kyc_status, cp.is_active
       FROM users u
       LEFT JOIN company_profiles cp ON u.id = cp.user_id
       WHERE u.id = $1 AND u.role = 'company'`,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      throw new NotFoundError('Company not found');
    }

    const company = companyResult.rows[0];

    // Get dashboard metrics
    const metricsQuery = `
      SELECT 
        COUNT(DISTINCT t.id) as total_tasks,
        COUNT(DISTINCT CASE WHEN t.status = 'active' THEN t.id END) as active_tasks,
        COUNT(ta.id) as total_attempts,
        COUNT(CASE WHEN ta.is_successful THEN 1 END) as total_conversions,
        ROUND(
          COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
          NULLIF(COUNT(ta.id), 0) * 100, 2
        ) as conversion_rate,
        COALESCE(SUM(t.reward_value), 0) as total_rewards_offered
      FROM tasks t
      LEFT JOIN task_attempts ta ON t.id = ta.task_id
      WHERE t.company_id = $1
    `;

    const metricsResult = await query(metricsQuery, [companyId]);
    const metrics = metricsResult.rows[0];

    // Get recent activity
    const recentActivityQuery = `
      SELECT 
        'task_created' as activity_type,
        t.title,
        t.created_at as timestamp
      FROM tasks t
      WHERE t.company_id = $1
      ORDER BY t.created_at DESC
      LIMIT 5
    `;

    const activityResult = await query(recentActivityQuery, [companyId]);

    // Get top performing tasks
    const topTasksQuery = `
      SELECT 
        t.id, t.title, t.difficulty, t.reward_value,
        COUNT(ta.id) as attempts,
        COUNT(CASE WHEN ta.is_successful THEN 1 END) as conversions,
        ROUND(
          COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
          NULLIF(COUNT(ta.id), 0) * 100, 2
        ) as conversion_rate
      FROM tasks t
      LEFT JOIN task_attempts ta ON t.id = ta.task_id
      WHERE t.company_id = $1 AND t.status = 'active'
      GROUP BY t.id, t.title, t.difficulty, t.reward_value
      ORDER BY conversion_rate DESC, attempts DESC
      LIMIT 5
    `;

    const topTasksResult = await query(topTasksQuery, [companyId]);

    return {
      company_info: company,
      metrics: {
        total_tasks: parseInt(metrics.total_tasks),
        active_tasks: parseInt(metrics.active_tasks),
        total_attempts: parseInt(metrics.total_attempts),
        total_conversions: parseInt(metrics.total_conversions),
        conversion_rate: parseFloat(metrics.conversion_rate),
        total_rewards_offered: parseFloat(metrics.total_rewards_offered)
      },
      recent_activity: activityResult.rows,
      top_performing_tasks: topTasksResult.rows
    };
  }

  /**
   * Submit company KYC
   * @param {string} companyId - Company ID
   * @param {Object} kycData - KYC data
   * @returns {Object} KYC submission result
   */
  async submitCompanyKYC(companyId, kycData) {
    const {
      company_name,
      gstin,
      pan_number,
      business_category,
      website_url,
      contact_person,
      registered_address,
      kyc_documents
    } = kycData;

    // Validate KYC data
    this.validateKYCData(kycData);

    // Check for duplicate GSTIN or PAN
    const duplicateCheck = await query(
      `SELECT id FROM company_profiles 
       WHERE (gstin = $1 OR pan_number = $2) AND user_id != $3`,
      [gstin, pan_number, companyId]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new ConflictError('GSTIN or PAN already registered');
    }

    // Update or create company profile
    const result = await query(
      `INSERT INTO company_profiles (
        user_id, company_name, gstin, pan_number, business_category,
        website_url, contact_person, registered_address, kyc_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      ON CONFLICT (user_id) 
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        gstin = EXCLUDED.gstin,
        pan_number = EXCLUDED.pan_number,
        business_category = EXCLUDED.business_category,
        website_url = EXCLUDED.website_url,
        contact_person = EXCLUDED.contact_person,
        registered_address = EXCLUDED.registered_address,
        kyc_status = 'pending',
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        companyId,
        company_name.trim(),
        gstin?.trim(),
        pan_number?.trim(),
        business_category?.trim(),
        website_url?.trim(),
        contact_person?.trim(),
        registered_address?.trim()
      ]
    );

    // TODO: Handle KYC document uploads
    // await this.uploadKYCDocuments(companyId, kyc_documents);

    logger.business('Company KYC submitted', {
      companyId,
      companyName: company_name,
      gstin,
      pan_number
    });

    return {
      kyc_status: 'pending',
      message: 'KYC documents submitted for verification'
    };
  }

  /**
   * Validate profile data
   * @param {Object} data - Profile data to validate
   */
  validateProfileData(data) {
    const {
      first_name,
      last_name,
      bio,
      city,
      state
    } = data;

    if (first_name && (first_name.trim().length < 1 || first_name.trim().length > 100)) {
      throw new ValidationError('First name must be between 1 and 100 characters');
    }

    if (last_name && (last_name.trim().length < 1 || last_name.trim().length > 100)) {
      throw new ValidationError('Last name must be between 1 and 100 characters');
    }

    if (bio && bio.length > 500) {
      throw new ValidationError('Bio must be less than 500 characters');
    }

    if (city && (city.trim().length < 2 || city.trim().length > 100)) {
      throw new ValidationError('City must be between 2 and 100 characters');
    }

    if (state && (state.trim().length < 2 || state.trim().length > 100)) {
      throw new ValidationError('State must be between 2 and 100 characters');
    }
  }

  /**
   * Validate KYC data
   * @param {Object} data - KYC data to validate
   */
  validateKYCData(data) {
    const {
      company_name,
      gstin,
      pan_number,
      business_category,
      website_url,
      contact_person,
      registered_address
    } = data;

    if (!company_name || company_name.trim().length < 2 || company_name.trim().length > 255) {
      throw new ValidationError('Company name must be between 2 and 255 characters');
    }

    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      throw new ValidationError('Invalid GSTIN format');
    }

    if (pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan_number)) {
      throw new ValidationError('Invalid PAN format');
    }

    if (website_url && !this.isValidUrl(website_url)) {
      throw new ValidationError('Invalid website URL');
    }

    if (!contact_person || contact_person.trim().length < 2 || contact_person.trim().length > 255) {
      throw new ValidationError('Contact person must be between 2 and 255 characters');
    }

    if (!registered_address || registered_address.trim().length < 10 || registered_address.trim().length > 1000) {
      throw new ValidationError('Registered address must be between 10 and 1000 characters');
    }
  }

  /**
   * Validate URL
   * @param {string} url - URL to validate
   * @returns {boolean} Is valid URL
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate unique reward code
   * @returns {string} Reward code
   */
  generateRewardCode() {
    const prefix = 'TL'; // TaskLoot
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * Get redemption instructions based on reward type
   * @param {string} rewardType - Type of reward
   * @returns {string} Redemption instructions
   */
  getRedemptionInstructions(rewardType) {
    const instructions = {
      discount: 'Show this code at the store or enter it during online checkout to avail the discount.',
      coupon: 'Use this code during online checkout to apply the coupon.',
      points: 'These points have been added to your account and can be redeemed for rewards.',
      cashback: 'The cashback amount will be credited to your registered bank account within 5-7 business days.'
    };

    return instructions[rewardType] || 'Please contact the company for redemption instructions.';
  }
}

module.exports = new UserService();
