const Razorpay = require('razorpay');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../database/connection');
const { cacheService } = require('../../cache/redis');
const logger = require('../../utils/logger');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  SecurityError
} = require('../../middleware/errorHandler');

class PaymentService {
  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    this.commissionRate = parseFloat(process.env.COMMISSION_RATE) || 0.15;
    this.featuredTaskCostPerDay = parseFloat(process.env.FEATURED_TASK_COST_PER_DAY) || 99;
  }

  /**
   * Create Razorpay order for featured task
   * @param {string} companyId - Company ID
   * @param {string} taskId - Task ID
   * @param {number} durationDays - Duration in days
   * @param {Object} paymentDetails - Payment details
   * @returns {Object} Razorpay order details
   */
  async createFeaturedTaskOrder(companyId, taskId, durationDays, paymentDetails) {
    const { payment_method, customer_email, customer_contact } = paymentDetails;

    // Validate input
    if (!durationDays || durationDays < 1 || durationDays > 30) {
      throw new ValidationError('Duration must be between 1 and 30 days');
    }

    // Verify task ownership
    const taskResult = await query(
      'SELECT id, title FROM tasks WHERE id = $1 AND company_id = $2',
      [taskId, companyId]
    );

    if (taskResult.rows.length === 0) {
      throw new NotFoundError('Task not found or access denied');
    }

    const task = taskResult.rows[0];

    // Calculate amount
    const amount = this.featuredTaskCostPerDay * durationDays;
    const amountInPaise = Math.round(amount * 100); // Convert to paise

    // Create Razorpay order
    try {
      const order = await this.razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `taskloot_featured_${taskId}_${Date.now()}`,
        notes: {
          company_id: companyId,
          task_id: taskId,
          duration_days: durationDays,
          payment_type: 'featured-task',
          customer_email,
          customer_contact,
          timestamp: Date.now()
        },
        payment_capture: 1,
        customer_notify: 1
      });

      // Save payment record to database
      await query(
        `INSERT INTO payments (
          razorpay_order_id, company_id, payment_type, amount, currency,
          status, payment_method, customer_email, customer_contact, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          companyId,
          'featured-task',
          amount,
          'INR',
          'initiated',
          payment_method,
          customer_email,
          customer_contact,
          JSON.stringify(order.notes)
        ]
      );

      logger.business('Payment order created', {
        orderId: order.id,
        companyId,
        taskId,
        amount,
        durationDays
      });

      return {
        razorpay_order_id: order.id,
        razorpay_key: process.env.RAZORPAY_KEY_ID,
        amount: amount,
        currency: 'INR',
        duration_days: durationDays,
        task_title: task.title
      };

    } catch (error) {
      logger.error('Failed to create Razorpay order:', error);
      throw new Error('Failed to create payment order');
    }
  }

  /**
   * Verify Razorpay payment signature
   * @param {string} orderId - Razorpay order ID
   * @param {string} paymentId - Razorpay payment ID
   * @param {string} signature - Razorpay signature
   * @returns {boolean} Is signature valid
   */
  verifyPaymentSignature(orderId, paymentId, signature) {
    try {
      const body = orderId + '|' + paymentId;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      logger.error('Payment signature verification failed:', error);
      return false;
    }
  }

  /**
   * Verify and process payment
   * @param {string} orderId - Razorpay order ID
   * @param {string} paymentId - Razorpay payment ID
   * @param {string} signature - Razorpay signature
   * @returns {Object} Payment verification result
   */
  async verifyPayment(orderId, paymentId, signature) {
    // Verify signature
    if (!this.verifyPaymentSignature(orderId, paymentId, signature)) {
      logger.security('Invalid payment signature', { orderId, paymentId });
      throw new SecurityError('Invalid payment signature');
    }

    // Get payment record
    const paymentResult = await query(
      'SELECT * FROM payments WHERE razorpay_order_id = $1',
      [orderId]
    );

    if (paymentResult.rows.length === 0) {
      throw new NotFoundError('Payment order not found');
    }

    const payment = paymentResult.rows[0];

    // Check if already processed
    if (payment.status === 'completed') {
      throw new ConflictError('Payment already processed');
    }

    // Verify payment with Razorpay
    try {
      const razorpayPayment = await this.razorpay.payments.fetch(paymentId);

      if (razorpayPayment.status !== 'captured') {
        throw new ValidationError('Payment not captured');
      }

      // Update payment status
      await query(
        `UPDATE payments 
         SET razorpay_payment_id = $1, status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE razorpay_order_id = $2`,
        [paymentId, orderId]
      );

      // Process based on payment type
      if (payment.payment_type === 'featured-task') {
        await this.processFeaturedTaskPayment(payment);
      }

      // Record transaction
      await this.recordTransaction(
        payment.company_id,
        'taskloot',
        'featured-paid',
        payment.amount,
        {
          payment_id: paymentId,
          order_id: orderId,
          payment_type: payment.payment_type
        }
      );

      logger.business('Payment verified and processed', {
        orderId,
        paymentId,
        companyId: payment.company_id,
        amount: payment.amount,
        paymentType: payment.payment_type
      });

      return {
        success: true,
        payment_id: paymentId,
        order_id: orderId,
        amount: payment.amount,
        status: 'completed'
      };

    } catch (error) {
      // Update payment status to failed
      await query(
        'UPDATE payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $2',
        ['failed', orderId]
      );

      logger.error('Payment verification failed:', error);
      throw error;
    }
  }

  /**
   * Process featured task payment
   * @param {Object} payment - Payment record
   */
  async processFeaturedTaskPayment(payment) {
    const metadata = JSON.parse(payment.metadata);
    const { task_id, duration_days } = metadata;

    // Calculate featured until date
    const featuredUntil = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000);

    // Update task to featured
    await query(
      `UPDATE tasks 
       SET is_featured = true, featured_until = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [featuredUntil, task_id]
    );

    // Clear cache
    await cacheService.del(`task:${task_id}`);

    logger.business('Task featured after payment', {
      taskId: task_id,
      companyId: payment.company_id,
      durationDays: duration_days,
      featuredUntil
    });
  }

  /**
   * Handle Razorpay webhook
   * @param {Object} webhookData - Webhook payload
   * @param {string} signature - Webhook signature
   * @returns {Object} Webhook processing result
   */
  async handleWebhook(webhookData, signature) {
    // Verify webhook signature
    const isValid = this.verifyWebhookSignature(webhookData, signature);
    if (!isValid) {
      logger.security('Invalid webhook signature', { signature });
      throw new SecurityError('Invalid webhook signature');
    }

    const event = webhookData.event;
    const payload = webhookData.payload;

    logger.info('Processing webhook', { event });

    try {
      switch (event) {
        case 'payment.captured':
          await this.handlePaymentCaptured(payload);
          break;
        case 'payment.failed':
          await this.handlePaymentFailed(payload);
          break;
        case 'refund.processed':
          await this.handleRefundProcessed(payload);
          break;
        default:
          logger.info('Unhandled webhook event', { event });
      }

      return { success: true, event };

    } catch (error) {
      logger.error('Webhook processing failed:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature
   * @param {Object} webhookData - Webhook data
   * @param {string} signature - Webhook signature
   * @returns {boolean} Is signature valid
   */
  verifyWebhookSignature(webhookData, signature) {
    try {
      const webhookSecret = this.webhookSecret;
      const body = JSON.stringify(webhookData);
      
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  /**
   * Handle payment captured webhook
   * @param {Object} payload - Payment payload
   */
  async handlePaymentCaptured(payload) {
    const { order_id, id: payment_id, amount, status } = payload.entity;

    // Update payment status if not already updated
    await query(
      `UPDATE payments 
       SET razorpay_payment_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE razorpay_order_id = $3 AND status != 'completed'`,
      [payment_id, status === 'captured' ? 'completed' : 'failed', order_id]
    );

    logger.business('Payment captured via webhook', {
      orderId: order_id,
      paymentId: payment_id,
      amount: amount / 100 // Convert from paise
    });
  }

  /**
   * Handle payment failed webhook
   * @param {Object} payload - Payment payload
   */
  async handlePaymentFailed(payload) {
    const { order_id, id: payment_id, error_code, error_description } = payload.entity;

    await query(
      `UPDATE payments 
       SET razorpay_payment_id = $1, status = 'failed', updated_at = CURRENT_TIMESTAMP
       WHERE razorpay_order_id = $2`,
      [payment_id, order_id]
    );

    logger.business('Payment failed via webhook', {
      orderId: order_id,
      paymentId: payment_id,
      errorCode: error_code,
      errorDescription: error_description
    });
  }

  /**
   * Handle refund processed webhook
   * @param {Object} payload - Refund payload
   */
  async handleRefundProcessed(payload) {
    const { payment_id, amount, status } = payload.entity;

    logger.business('Refund processed via webhook', {
      paymentId: payment_id,
      amount: amount / 100,
      status
    });
  }

  /**
   * Get payment history for company
   * @param {string} companyId - Company ID
   * @param {Object} filters - Filter options
   * @returns {Object} Payment history with pagination
   */
  async getPaymentHistory(companyId, filters = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      payment_type,
      from_date,
      to_date
    } = filters;

    const offset = (page - 1) * limit;
    let whereConditions = ['company_id = $1'];
    let queryParams = [companyId];
    let paramIndex = 2;

    // Add filters
    if (status) {
      whereConditions.push(`status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }

    if (payment_type) {
      whereConditions.push(`payment_type = $${paramIndex}`);
      queryParams.push(payment_type);
      paramIndex++;
    }

    if (from_date) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      queryParams.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      queryParams.push(to_date);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM payments WHERE ${whereClause}`;
    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get payments
    const paymentsQuery = `
      SELECT 
        id, razorpay_order_id, razorpay_payment_id, payment_type,
        amount, currency, status, payment_method, customer_email,
        created_at, updated_at, metadata
      FROM payments
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const paymentsResult = await query(paymentsQuery, queryParams);

    const totalPages = Math.ceil(total / limit);

    return {
      payments: paymentsResult.rows.map(payment => ({
        ...payment,
        metadata: payment.metadata ? JSON.parse(payment.metadata) : null
      })),
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
   * Record transaction
   * @param {string} fromEntityId - From entity ID
   * @param {string} toEntityId - To entity ID
   * @param {string} transactionType - Transaction type
   * @param {number} amount - Amount
   * @param {Object} metadata - Additional metadata
   */
  async recordTransaction(fromEntityId, toEntityId, transactionType, amount, metadata = {}) {
    await query(
      `INSERT INTO transactions (
        from_entity_id, to_entity_id, transaction_type, amount, metadata
      ) VALUES ($1, $2, $3, $4, $5)`,
      [fromEntityId, toEntityId, transactionType, amount, JSON.stringify(metadata)]
    );

    logger.business('Transaction recorded', {
      fromEntityId,
      toEntityId,
      transactionType,
      amount,
      metadata
    });
  }

  /**
   * Calculate commission earnings
   * @param {string} companyId - Company ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Commission details
   */
  async calculateCommissionEarnings(companyId, startDate, endDate) {
    const queryText = `
      SELECT 
        COUNT(*) as total_successful_tasks,
        COALESCE(SUM(t.reward_value), 0) as total_rewards_given,
        COALESCE(SUM(t.reward_value * $1), 0) as commission_earned
      FROM tasks t
      JOIN task_attempts ta ON t.id = ta.task_id
      WHERE t.company_id = $2 
        AND ta.is_successful = true
        AND ta.created_at BETWEEN $3 AND $4
    `;

    const result = await query(queryText, [
      this.commissionRate,
      companyId,
      startDate,
      endDate
    ]);

    return result.rows[0];
  }

  /**
   * Create payout for company
   * @param {string} companyId - Company ID
   * @param {number} amount - Payout amount
   * @param {Date} periodStart - Period start
   * @param {Date} periodEnd - Period end
   * @returns {Object} Payout details
   */
  async createPayout(companyId, amount, periodStart, periodEnd) {
    // Get company bank account
    const bankAccountResult = await query(
      `SELECT ba.* FROM bank_accounts ba
       WHERE ba.company_id = $1 AND ba.is_verified = true
       ORDER BY ba.created_at DESC
       LIMIT 1`,
      [companyId]
    );

    if (bankAccountResult.rows.length === 0) {
      throw new ValidationError('No verified bank account found for payout');
    }

    const bankAccount = bankAccountResult.rows[0];

    // Create payout record
    const result = await query(
      `INSERT INTO payouts (
        company_id, amount, currency, status,
        payout_period_start, payout_period_end, bank_account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        companyId,
        amount,
        'INR',
        'pending',
        periodStart,
        periodEnd,
        bankAccount.id
      ]
    );

    const payout = result.rows[0];

    logger.business('Payout created', {
      payoutId: payout.id,
      companyId,
      amount,
      periodStart,
      periodEnd
    });

    return payout;
  }

  /**
   * Process payout via Razorpay
   * @param {string} payoutId - Payout ID
   * @returns {Object} Razorpay payout result
   */
  async processPayout(payoutId) {
    // Get payout details
    const payoutResult = await query(
      `SELECT p.*, ba.account_number, ba.account_holder_name, ba.ifsc_code
       FROM payouts p
       JOIN bank_accounts ba ON p.bank_account_id = ba.id
       WHERE p.id = $1 AND p.status = 'pending'`,
      [payoutId]
    );

    if (payoutResult.rows.length === 0) {
      throw new NotFoundError('Payout not found or already processed');
    }

    const payout = payoutResult.rows[0];

    try {
      // Create Razorpay payout
      const razorpayPayout = await this.razorpay.payouts.create({
        account_number: payout.account_number,
        fund_account_id: null, // Will be created if needed
        amount: Math.round(payout.amount * 100), // Convert to paise
        currency: 'INR',
        mode: 'NEFT',
        purpose: 'payout',
        description: `TaskLoot Commission Payout - ${new Date().toISOString()}`,
        notes: {
          payout_id: payoutId,
          company_id: payout.company_id
        }
      });

      // Update payout record
      await query(
        `UPDATE payouts 
         SET razorpay_payout_id = $1, status = 'processed', 
             attempted_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [razorpayPayout.id, payoutId]
      );

      // Record transaction
      await this.recordTransaction(
        'taskloot',
        payout.company_id,
        'payout',
        payout.amount,
        {
          payout_id: payoutId,
          razorpay_payout_id: razorpayPayout.id
        }
      );

      logger.business('Payout processed', {
        payoutId,
        razorpayPayoutId: razorpayPayout.id,
        companyId: payout.company_id,
        amount: payout.amount
      });

      return {
        success: true,
        payout_id: payoutId,
        razorpay_payout_id: razorpayPayout.id,
        status: 'processed'
      };

    } catch (error) {
      // Update payout status to failed
      await query(
        `UPDATE payouts 
         SET status = 'failed', attempted_at = CURRENT_TIMESTAMP, 
             failure_reason = $1
         WHERE id = $2`,
        [error.message, payoutId]
      );

      logger.error('Payout processing failed:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();
