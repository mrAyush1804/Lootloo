const { query } = require('../../database/connection');
const { cacheService } = require('../../cache/redis');
const logger = require('../../utils/logger');

class AnalyticsService {
  /**
   * Track custom event for analytics
   * @param {string} eventType - Type of event
   * @param {Object} userData - User and event data
   */
  async trackEvent(eventType, userData) {
    const { user_id, task_id, company_id, metadata } = userData;

    try {
      // Push to analytics queue for batch processing
      await cacheService.pushToQueue(
        `analytics:events:queue:${new Date().toISOString().split('T')[0]}`,
        {
          event_type: eventType,
          user_id,
          task_id,
          company_id,
          metadata,
          timestamp: Date.now()
        }
      );

      // Immediately insert critical events for real-time dashboard
      const criticalEvents = ['task_completed', 'reward_claimed', 'user_registered', 'payment_completed'];
      
      if (criticalEvents.includes(eventType)) {
        await query(
          `INSERT INTO analytics_events (event_type, user_id, task_id, company_id, event_data)
           VALUES ($1, $2, $3, $4, $5)`,
          [eventType, user_id, task_id, company_id, JSON.stringify(metadata)]
        );
      }

      logger.business('Analytics event tracked', {
        eventType,
        userId: user_id,
        taskId: task_id,
        companyId: company_id
      });

    } catch (error) {
      logger.error('Analytics tracking failed:', error);
      // Non-blocking - don't fail the main operation
    }
  }

  /**
   * Get comprehensive company metrics
   * @param {string} companyId - Company ID
   * @param {number} periodDays - Period in days
   * @returns {Object} Company metrics
   */
  async getCompanyMetrics(companyId, periodDays = 30) {
    const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    try {
      // 1. Tasks published
      const tasksPublished = await query(`
        SELECT COUNT(*) as count FROM tasks
        WHERE company_id = $1 AND created_at >= $2
      `, [companyId, startDate]);

      // 2. Total attempts
      const totalAttempts = await query(`
        SELECT COUNT(*) as count FROM task_attempts ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.company_id = $1 AND ta.created_at >= $2
      `, [companyId, startDate]);

      // 3. Successful conversions
      const conversions = await query(`
        SELECT COUNT(*) as count FROM task_attempts ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.company_id = $1 AND ta.is_successful = true AND ta.created_at >= $2
      `, [companyId, startDate]);

      // 4. Conversion rate
      const conversionRate = totalAttempts.rows[0].count > 0
        ? (conversions.rows[0].count / totalAttempts.rows[0].count) * 100
        : 0;

      // 5. Avg solve time
      const avgSolveTime = await query(`
        SELECT AVG(time_taken_seconds) as avg_time FROM task_attempts ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.company_id = $1 AND ta.is_successful = true AND ta.created_at >= $2
      `, [companyId, startDate]);

      // 6. Task performance ranking
      const taskPerformance = await query(`
        SELECT 
          t.id, t.title, t.difficulty, t.reward_value,
          COUNT(ta.id) as attempts,
          SUM(CASE WHEN ta.is_successful THEN 1 ELSE 0 END) as conversions,
          ROUND(
            (SUM(CASE WHEN ta.is_successful THEN 1 ELSE 0 END)::float / COUNT(ta.id)) * 100, 2
          ) as conversion_rate,
          AVG(ta.time_taken_seconds) as avg_completion_time
        FROM tasks t
        LEFT JOIN task_attempts ta ON t.id = ta.task_id
        WHERE t.company_id = $1 AND ta.created_at >= $2
        GROUP BY t.id, t.title, t.difficulty, t.reward_value
        ORDER BY conversion_rate DESC, attempts DESC
      `, [companyId, startDate]);

      // 7. Daily trends
      const dailyTrends = await query(`
        SELECT 
          DATE(ta.created_at) as date,
          COUNT(*) as attempts,
          COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts,
          COUNT(DISTINCT ta.user_id) as unique_users
        FROM task_attempts ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.company_id = $1 AND ta.created_at >= $2
        GROUP BY DATE(ta.created_at)
        ORDER BY date DESC
      `, [companyId, startDate]);

      // 8. User demographics
      const userDemographics = await query(`
        SELECT 
          COUNT(DISTINCT ta.user_id) as total_users,
          COUNT(DISTINCT CASE WHEN ta.is_successful THEN ta.user_id END) as successful_users,
          AVG(attempts_per_user) as avg_attempts_per_user
        FROM (
          SELECT 
            ta.user_id,
            COUNT(*) as attempts_per_user,
            COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts
          FROM task_attempts ta
          JOIN tasks t ON ta.task_id = t.id
          WHERE t.company_id = $1 AND ta.created_at >= $2
          GROUP BY ta.user_id
        ) as user_stats
      `, [companyId, startDate]);

      // 9. Reward distribution
      const rewardDistribution = await query(`
        SELECT 
          ur.reward_type,
          COUNT(*) as count,
          SUM(ur.reward_value) as total_value,
          COUNT(CASE WHEN ur.is_redeemed THEN 1 END) as redeemed_count
        FROM user_rewards ur
        JOIN tasks t ON ur.task_id = t.id
        WHERE t.company_id = $1 AND ur.created_at >= $2
        GROUP BY ur.reward_type
      `, [companyId, startDate]);

      return {
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days: periodDays
        },
        summary: {
          tasks_published: parseInt(tasksPublished.rows[0].count),
          total_attempts: parseInt(totalAttempts.rows[0].count),
          successful_conversions: parseInt(conversions.rows[0].count),
          conversion_rate: parseFloat(conversionRate.toFixed(2)),
          avg_solve_time_seconds: parseFloat(avgSolveTime.rows[0].avg_time || 0)
        },
        task_performance: taskPerformance.rows,
        daily_trends: dailyTrends.rows,
        user_demographics: {
          total_users: parseInt(userDemographics.rows[0].total_users || 0),
          successful_users: parseInt(userDemographics.rows[0].successful_users || 0),
          avg_attempts_per_user: parseFloat(userDemographics.rows[0].avg_attempts_per_user || 0)
        },
        reward_distribution: rewardDistribution.rows
      };

    } catch (error) {
      logger.error('Failed to get company metrics:', error);
      throw error;
    }
  }

  /**
   * Get global platform metrics
   * @param {number} periodDays - Period in days
   * @returns {Object} Global metrics
   */
  async getGlobalMetrics(periodDays = 30) {
    const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    try {
      // 1. User metrics
      const userMetrics = await query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_verified = true THEN 1 END) as verified_users,
          COUNT(CASE WHEN role = 'player' THEN 1 END) as total_players,
          COUNT(CASE WHEN role = 'company' THEN 1 END) as total_companies,
          COUNT(CASE WHEN created_at >= $1 THEN 1 END) as new_users
        FROM users
      `, [startDate]);

      // 2. Task metrics
      const taskMetrics = await query(`
        SELECT 
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_tasks,
          COUNT(CASE WHEN is_featured = true AND featured_until > CURRENT_TIMESTAMP THEN 1 END) as featured_tasks,
          COUNT(CASE WHEN created_at >= $1 THEN 1 END) as new_tasks
        FROM tasks
      `, [startDate]);

      // 3. Engagement metrics
      const engagementMetrics = await query(`
        SELECT 
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN is_successful THEN 1 END) as successful_attempts,
          COUNT(DISTINCT user_id) as active_users,
          AVG(time_taken_seconds) as avg_completion_time
        FROM task_attempts
        WHERE created_at >= $1
      `, [startDate]);

      // 4. Reward metrics
      const rewardMetrics = await query(`
        SELECT 
          COUNT(*) as total_rewards,
          COUNT(CASE WHEN is_redeemed = false THEN 1 END) as unredeemed_rewards,
          SUM(reward_value) as total_reward_value,
          COUNT(CASE WHEN created_at >= $1 THEN 1 END) as new_rewards
        FROM user_rewards
      `, [startDate]);

      // 5. Revenue metrics
      const revenueMetrics = await query(`
        SELECT 
          COUNT(*) as total_transactions,
          SUM(amount) as total_revenue,
          COUNT(CASE WHEN status = 'completed' AND created_at >= $1 THEN 1 END) as recent_transactions
        FROM payments
        WHERE status = 'completed'
      `, [startDate]);

      // 6. Daily active users (DAU)
      const dauMetrics = await query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT user_id) as daily_active_users
        FROM (
          SELECT user_id, created_at FROM users WHERE created_at >= $1
          UNION ALL
          SELECT user_id, created_at FROM task_attempts WHERE created_at >= $1
          UNION ALL
          SELECT user_id, created_at FROM user_rewards WHERE created_at >= $1
        ) as user_activities
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `, [startDate]);

      // 7. Top performing companies
      const topCompanies = await query(`
        SELECT 
          cp.company_name,
          COUNT(DISTINCT t.id) as total_tasks,
          COUNT(ta.id) as total_attempts,
          COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts,
          ROUND(
            (COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
             NULLIF(COUNT(ta.id), 0)) * 100, 2
          ) as conversion_rate
        FROM company_profiles cp
        JOIN users u ON cp.user_id = u.id
        JOIN tasks t ON u.id = t.company_id
        LEFT JOIN task_attempts ta ON t.id = ta.task_id
        WHERE ta.created_at >= $1 OR ta.created_at IS NULL
        GROUP BY cp.company_name, cp.user_id
        HAVING COUNT(ta.id) > 0
        ORDER BY successful_attempts DESC
        LIMIT 10
      `, [startDate]);

      return {
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days: periodDays
        },
        users: {
          total_users: parseInt(userMetrics.rows[0].total_users),
          verified_users: parseInt(userMetrics.rows[0].verified_users),
          total_players: parseInt(userMetrics.rows[0].total_players),
          total_companies: parseInt(userMetrics.rows[0].total_companies),
          new_users: parseInt(userMetrics.rows[0].new_users)
        },
        tasks: {
          total_tasks: parseInt(taskMetrics.rows[0].total_tasks),
          active_tasks: parseInt(taskMetrics.rows[0].active_tasks),
          featured_tasks: parseInt(taskMetrics.rows[0].featured_tasks),
          new_tasks: parseInt(taskMetrics.rows[0].new_tasks)
        },
        engagement: {
          total_attempts: parseInt(engagementMetrics.rows[0].total_attempts),
          successful_attempts: parseInt(engagementMetrics.rows[0].successful_attempts),
          active_users: parseInt(engagementMetrics.rows[0].active_users),
          avg_completion_time_seconds: parseFloat(engagementMetrics.rows[0].avg_completion_time || 0)
        },
        rewards: {
          total_rewards: parseInt(rewardMetrics.rows[0].total_rewards),
          unredeemed_rewards: parseInt(rewardMetrics.rows[0].unredeemed_rewards),
          total_reward_value: parseFloat(rewardMetrics.rows[0].total_reward_value || 0),
          new_rewards: parseInt(rewardMetrics.rows[0].new_rewards)
        },
        revenue: {
          total_transactions: parseInt(revenueMetrics.rows[0].total_transactions),
          total_revenue: parseFloat(revenueMetrics.rows[0].total_revenue || 0),
          recent_transactions: parseInt(revenueMetrics.rows[0].recent_transactions)
        },
        daily_active_users: dauMetrics.rows,
        top_companies: topCompanies.rows
      };

    } catch (error) {
      logger.error('Failed to get global metrics:', error);
      throw error;
    }
  }

  /**
   * Run A/B test
   * @param {string} testId - Test ID
   * @param {Object} variantA - Variant A configuration
   * @param {Object} variantB - Variant B configuration
   * @returns {Object} A/B test configuration
   */
  async runABTest(testId, variantA, variantB) {
    const test = {
      id: testId,
      created_at: Date.now(),
      variants: {
        a: {
          name: variantA.name,
          traffic_allocation: 0.5,
          conversions: 0,
          views: 0
        },
        b: {
          name: variantB.name,
          traffic_allocation: 0.5,
          conversions: 0,
          views: 0
        }
      },
      is_significant: false
    };

    await cacheService.set(`ab_test:${testId}`, test, 30 * 24 * 60 * 60); // 30 days
    return test;
  }

  /**
   * Get variant for user in A/B test
   * @param {string} testId - Test ID
   * @param {string} userId - User ID
   * @returns {string} Variant ('a' or 'b')
   */
  getUserVariant(testId, userId) {
    const crypto = require('crypto');
    const hash = parseInt(crypto.createHash('md5').update(userId + testId).digest('hex').substring(0, 8), 16);
    return hash % 2 === 0 ? 'a' : 'b';
  }

  /**
   * Process analytics events from queue
   * @param {string} date - Date to process (YYYY-MM-DD format)
   */
  async processEventQueue(date) {
    try {
      const queueKey = `analytics:events:queue:${date}`;
      const queueLength = await cacheService.getQueueLength(queueKey);

      if (queueLength === 0) {
        logger.info('No events to process', { date });
        return;
      }

      logger.info('Processing analytics events', { date, queueLength });

      let processedCount = 0;
      const batchSize = 100;

      while (true) {
        const events = [];
        for (let i = 0; i < batchSize; i++) {
          const event = await cacheService.popFromQueue(queueKey);
          if (!event) break;
          events.push(event);
        }

        if (events.length === 0) break;

        // Batch insert events
        const values = events.map(event => 
          `('${event.event_type}', '${event.user_id}', ${event.task_id ? `'${event.task_id}'` : 'NULL'}, ${event.company_id ? `'${event.company_id}'` : 'NULL'}, '${JSON.stringify(event.metadata)}', to_timestamp(${event.timestamp / 1000}))`
        ).join(',');

        await query(`
          INSERT INTO analytics_events (event_type, user_id, task_id, company_id, event_data, created_at)
          VALUES ${values}
        `);

        processedCount += events.length;
        logger.debug('Processed batch of events', { batchSize: events.length, totalProcessed: processedCount });
      }

      logger.info('Analytics events processing completed', { date, processedCount });

    } catch (error) {
      logger.error('Failed to process analytics events:', error);
      throw error;
    }
  }
}

module.exports = new AnalyticsService();
