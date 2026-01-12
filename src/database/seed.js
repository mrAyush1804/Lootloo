const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('./connection');
const logger = require('../utils/logger');

class DatabaseSeeder {
  constructor() {
    this.bcryptRounds = 10;
  }

  /**
   * Seed the database with initial data
   */
  async seed() {
    try {
      logger.info('Starting database seeding...');

      await this.seedUsers();
      await this.seedCompanyProfiles();
      await this.seedUserProfiles();
      await this.seedBankAccounts();
      await this.seedTasks();
      await this.seedSampleData();

      logger.info('Database seeding completed successfully');

    } catch (error) {
      logger.error('Database seeding failed:', error);
      throw error;
    }
  }

  /**
   * Seed users
   */
  async seedUsers() {
    logger.info('Seeding users...');

    const users = [
      {
        email: 'admin@taskloot.com',
        password: 'Admin123!',
        role: 'admin',
        is_verified: true,
        is_active: true
      },
      {
        email: 'player1@example.com',
        password: 'Player123!',
        role: 'player',
        is_verified: true,
        is_active: true
      },
      {
        email: 'player2@example.com',
        password: 'Player123!',
        role: 'player',
        is_verified: true,
        is_active: true
      },
      {
        email: 'company1@example.com',
        password: 'Company123!',
        role: 'company',
        is_verified: true,
        is_active: true
      },
      {
        email: 'company2@example.com',
        password: 'Company123!',
        role: 'company',
        is_verified: true,
        is_active: true
      }
    ];

    for (const userData of users) {
      const passwordHash = await bcrypt.hash(userData.password, this.bcryptRounds);
      
      await query(
        `INSERT INTO users (email, password_hash, role, is_verified, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [userData.email, passwordHash, userData.role, userData.is_verified, userData.is_active]
      );
    }

    logger.info('Users seeded successfully');
  }

  /**
   * Seed company profiles
   */
  async seedCompanyProfiles() {
    logger.info('Seeding company profiles...');

    const companies = [
      {
        email: 'company1@example.com',
        company_name: 'Pizza Paradise',
        gstin: '27AAAPL1234C1ZV',
        pan_number: 'AAAPL1234C',
        business_category: 'Food & Beverage',
        website_url: 'https://pizzaparadise.com',
        contact_person: 'John Doe',
        registered_address: '123 Main Street, Mumbai, Maharashtra 400001',
        kyc_status: 'verified'
      },
      {
        email: 'company2@example.com',
        company_name: 'Fashion Hub',
        gstin: '27AAAFH5678B2ZV',
        pan_number: 'AAAFH5678B',
        business_category: 'Fashion & Apparel',
        website_url: 'https://fashionhub.com',
        contact_person: 'Jane Smith',
        registered_address: '456 Park Avenue, Delhi, Delhi 110001',
        kyc_status: 'verified'
      }
    ];

    for (const companyData of companies) {
      await query(
        `INSERT INTO company_profiles (
          user_id, company_name, gstin, pan_number, business_category,
          website_url, contact_person, registered_address, kyc_status, kyc_verified_at
        ) SELECT u.id, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
         FROM users u WHERE u.email = $1
         ON CONFLICT (user_id) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           gstin = EXCLUDED.gstin,
           pan_number = EXCLUDED.pan_number,
           business_category = EXCLUDED.business_category,
           website_url = EXCLUDED.website_url,
           contact_person = EXCLUDED.contact_person,
           registered_address = EXCLUDED.registered_address,
           kyc_status = EXCLUDED.kyc_status,
           kyc_verified_at = CURRENT_TIMESTAMP`,
        [
          companyData.email,
          companyData.company_name,
          companyData.gstin,
          companyData.pan_number,
          companyData.business_category,
          companyData.website_url,
          companyData.contact_person,
          companyData.registered_address,
          companyData.kyc_status
        ]
      );
    }

    logger.info('Company profiles seeded successfully');
  }

  /**
   * Seed user profiles
   */
  async seedUserProfiles() {
    logger.info('Seeding user profiles...');

    const profiles = [
      {
        email: 'player1@example.com',
        first_name: 'Alice',
        last_name: 'Johnson',
        city: 'Mumbai',
        state: 'Maharashtra',
        bio: 'Puzzle enthusiast and foodie'
      },
      {
        email: 'player2@example.com',
        first_name: 'Bob',
        last_name: 'Smith',
        city: 'Delhi',
        state: 'Delhi',
        bio: 'Gaming lover and fashion enthusiast'
      }
    ];

    for (const profileData of profiles) {
      await query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, city, state, bio)
         SELECT u.id, $2, $3, $4, $5, $6
         FROM users u WHERE u.email = $1
         ON CONFLICT (user_id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           city = EXCLUDED.city,
           state = EXCLUDED.state,
           bio = EXCLUDED.bio`,
        [
          profileData.email,
          profileData.first_name,
          profileData.last_name,
          profileData.city,
          profileData.state,
          profileData.bio
        ]
      );
    }

    logger.info('User profiles seeded successfully');
  }

  /**
   * Seed bank accounts
   */
  async seedBankAccounts() {
    logger.info('Seeding bank accounts...');

    const bankAccounts = [
      {
        email: 'company1@example.com',
        account_number: '1234567890',
        account_holder_name: 'Pizza Paradise',
        ifsc_code: 'HDFC0001234',
        bank_name: 'HDFC Bank',
        account_type: 'current',
        is_verified: true
      },
      {
        email: 'company2@example.com',
        account_number: '0987654321',
        account_holder_name: 'Fashion Hub',
        ifsc_code: 'ICIC0005678',
        bank_name: 'ICICI Bank',
        account_type: 'current',
        is_verified: true
      }
    ];

    for (const bankData of bankAccounts) {
      await query(
        `INSERT INTO bank_accounts (
          company_id, account_number, account_holder_name, ifsc_code,
          bank_name, account_type, is_verified, verified_at
        ) SELECT u.id, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
         FROM users u WHERE u.email = $1
         ON CONFLICT (company_id, account_number) DO UPDATE SET
           account_holder_name = EXCLUDED.account_holder_name,
           ifsc_code = EXCLUDED.ifsc_code,
           bank_name = EXCLUDED.bank_name,
           account_type = EXCLUDED.account_type,
           is_verified = EXCLUDED.is_verified,
           verified_at = CURRENT_TIMESTAMP`,
        [
          bankData.email,
          bankData.account_number,
          bankData.account_holder_name,
          bankData.ifsc_code,
          bankData.bank_name,
          bankData.account_type,
          bankData.is_verified
        ]
      );
    }

    logger.info('Bank accounts seeded successfully');
  }

  /**
   * Seed sample tasks
   */
  async seedTasks() {
    logger.info('Seeding tasks...');

    const tasks = [
      {
        email: 'company1@example.com',
        title: 'Pizza Paradise Logo Puzzle',
        description: 'Solve this fun pizza-themed puzzle to get a 20% discount on your next order!',
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 20.00,
        reward_description: '20% off on your next pizza order',
        status: 'active',
        is_featured: true,
        featured_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
      },
      {
        email: 'company1@example.com',
        title: 'Find the Hidden Ingredient',
        description: 'Spot the difference in these pizza images and win a free garlic bread!',
        task_type: 'spot-diff',
        difficulty: 'medium',
        reward_type: 'coupon',
        reward_value: 150.00,
        reward_description: 'Free garlic bread with any pizza',
        status: 'active'
      },
      {
        email: 'company2@example.com',
        title: 'Fashion Mix & Match',
        description: 'Complete this fashion puzzle to get 15% off on your next purchase!',
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 15.00,
        reward_description: '15% off on fashion items',
        status: 'active'
      },
      {
        email: 'company2@example.com',
        title: 'Speed Style Challenge',
        description: 'Complete this fashion puzzle in under 2 minutes to win exclusive rewards!',
        task_type: 'speed-challenge',
        difficulty: 'hard',
        reward_type: 'points',
        reward_value: 500.00,
        reward_description: '500 loyalty points',
        status: 'draft'
      }
    ];

    for (const taskData of tasks) {
      const result = await query(
        `INSERT INTO tasks (
          company_id, title, description, task_type, difficulty,
          reward_type, reward_value, reward_description, status,
          is_featured, featured_until
        ) SELECT u.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         FROM users u WHERE u.email = $1
         RETURNING id`,
        [
          taskData.email,
          taskData.title,
          taskData.description,
          taskData.task_type,
          taskData.difficulty,
          taskData.reward_type,
          taskData.reward_value,
          taskData.reward_description,
          taskData.status,
          taskData.is_featured || false,
          taskData.featured_until || null
        ]
      );

      // Store task ID for sample data creation
      if (taskData.title.includes('Pizza Paradise Logo Puzzle')) {
        this.pizzaTaskId = result.rows[0].id;
      } else if (taskData.title.includes('Fashion Mix & Match')) {
        this.fashionTaskId = result.rows[0].id;
      }
    }

    logger.info('Tasks seeded successfully');
  }

  /**
   * Seed sample data (attempts, rewards, etc.)
   */
  async seedSampleData() {
    logger.info('Seeding sample data...');

    // Create sample task attempts
    const attempts = [
      {
        email: 'player1@example.com',
        task_title: 'Pizza Paradise Logo Puzzle',
        is_successful: true,
        time_taken_seconds: 120
      },
      {
        email: 'player2@example.com',
        task_title: 'Fashion Mix & Match',
        is_successful: true,
        time_taken_seconds: 95
      },
      {
        email: 'player1@example.com',
        task_title: 'Fashion Mix & Match',
        is_successful: false,
        time_taken_seconds: 180
      }
    ];

    for (const attemptData of attempts) {
      await query(
        `INSERT INTO task_attempts (task_id, user_id, started_at, completed_at, is_successful, time_taken_seconds)
         SELECT t.id, u.id, 
                CURRENT_TIMESTAMP - INTERVAL '${attemptData.time_taken_seconds} seconds',
                CURRENT_TIMESTAMP, $3, $4
         FROM tasks t, users u
         WHERE t.title = $1 AND u.email = $2`,
        [
          attemptData.task_title,
          attemptData.email,
          attemptData.is_successful,
          attemptData.time_taken_seconds
        ]
      );
    }

    // Create sample rewards
    const rewards = [
      {
        email: 'player1@example.com',
        task_title: 'Pizza Paradise Logo Puzzle',
        reward_type: 'discount',
        reward_value: 20.00
      },
      {
        email: 'player2@example.com',
        task_title: 'Fashion Mix & Match',
        reward_type: 'discount',
        reward_value: 15.00
      }
    ];

    for (const rewardData of rewards) {
      await query(
        `INSERT INTO user_rewards (user_id, task_id, reward_code, reward_type, reward_value, expires_at)
         SELECT u.id, t.id, 
                'TL' || EXTRACT(EPOCH FROM NOW())::bigint || substr(md5(random()::text), 1, 6),
                $3, $4, CURRENT_TIMESTAMP + INTERVAL '30 days'
         FROM users u, tasks t
         WHERE u.email = $1 AND t.title = $2`,
        [
          rewardData.email,
          rewardData.task_title,
          rewardData.reward_type,
          rewardData.reward_value
        ]
      );
    }

    // Create sample payment
    await query(
      `INSERT INTO payments (
        razorpay_order_id, company_id, payment_type, amount, currency, status
      ) SELECT 
         'order_test_' || substr(md5(random()::text), 1, 10),
         u.id, 'featured-task', 99.00, 'INR', 'completed'
       FROM users u WHERE u.email = 'company1@example.com'`
    );

    logger.info('Sample data seeded successfully');
  }

  /**
   * Clear all seed data (for testing)
   */
  async clear() {
    logger.info('Clearing seed data...');

    const tables = [
      'user_rewards',
      'task_attempts',
      'payments',
      'payouts',
      'invoices',
      'transactions',
      'analytics_events',
      'analytics_metrics',
      'tasks',
      'bank_accounts',
      'company_profiles',
      'user_profiles',
      'tokens',
      'users'
    ];

    // Disable foreign key constraints temporarily
    await query('SET session_replication_role = replica');

    try {
      for (const table of tables) {
        await query(`DELETE FROM ${table}`);
        logger.info(`Cleared table: ${table}`);
      }
    } finally {
      // Re-enable foreign key constraints
      await query('SET session_replication_role = DEFAULT');
    }

    logger.info('Seed data cleared successfully');
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];

  try {
    // Connect to database
    await connectDatabase();

    const seeder = new DatabaseSeeder();

    switch (command) {
      case 'seed':
        await seeder.seed();
        break;

      case 'clear':
        await seeder.clear();
        break;

      default:
        console.log('Usage:');
        console.log('  node seed.js seed    # Seed the database with initial data');
        console.log('  node seed.js clear   # Clear all seed data');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    logger.error('Seed command failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = DatabaseSeeder;

// Run CLI if called directly
if (require.main === module) {
  main();
}
