-- TaskLoot Database Schema
-- Production-ready schema with proper indexes, constraints, and optimizations

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('player', 'company', 'admin')),
    profile_data JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_created_at ON users(created_at);

-- =============================================
-- TOKENS TABLE
-- =============================================
CREATE TABLE tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('refresh', 'reset', 'verification')),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for tokens table
CREATE INDEX idx_tokens_user_id ON tokens(user_id);
CREATE INDEX idx_tokens_token_type ON tokens(token_type);
CREATE INDEX idx_tokens_expires_at ON tokens(expires_at);
CREATE INDEX idx_tokens_is_revoked ON tokens(is_revoked);

-- =============================================
-- USER PROFILES TABLE
-- =============================================
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url VARCHAR(500),
    bio TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    preferences JSONB DEFAULT '{"notifications": true, "theme": "light"}',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for user_profiles table
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_city ON user_profiles(city);
CREATE INDEX idx_user_profiles_state ON user_profiles(state);

-- =============================================
-- COMPANY PROFILES TABLE
-- =============================================
CREATE TABLE company_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    gstin VARCHAR(15) UNIQUE,
    pan_number VARCHAR(10) UNIQUE,
    kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
    kyc_verified_at TIMESTAMP,
    business_category VARCHAR(100),
    website_url VARCHAR(500),
    contact_person VARCHAR(255),
    registered_address TEXT,
    bank_account_id UUID REFERENCES bank_accounts(id),
    logo_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for company_profiles table
CREATE INDEX idx_company_profiles_user_id ON company_profiles(user_id);
CREATE INDEX idx_company_profiles_gstin ON company_profiles(gstin);
CREATE INDEX idx_company_profiles_pan_number ON company_profiles(pan_number);
CREATE INDEX idx_company_profiles_kyc_status ON company_profiles(kyc_status);
CREATE INDEX idx_company_profiles_business_category ON company_profiles(business_category);

-- =============================================
-- BANK ACCOUNTS TABLE
-- =============================================
CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number VARCHAR(20) NOT NULL,
    account_holder_name VARCHAR(255),
    ifsc_code VARCHAR(11),
    bank_name VARCHAR(255),
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('current', 'savings')),
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, account_number)
);

-- Indexes for bank_accounts table
CREATE INDEX idx_bank_accounts_company_id ON bank_accounts(company_id);
CREATE INDEX idx_bank_accounts_is_verified ON bank_accounts(is_verified);

-- =============================================
-- TASKS TABLE
-- =============================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('image-puzzle', 'spot-diff', 'speed-challenge', 'meme', 'logic')),
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
    reward_type VARCHAR(20) NOT NULL CHECK (reward_type IN ('discount', 'coupon', 'points', 'cashback')),
    reward_value DECIMAL(10, 2) NOT NULL CHECK (reward_value > 0),
    reward_description VARCHAR(255) NOT NULL,
    image_url VARCHAR(500),
    puzzle_config JSONB,
    is_published BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    featured_until TIMESTAMP,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'active', 'blocked', 'expired')),
    attempt_count INT DEFAULT 0,
    conversion_count INT DEFAULT 0,
    conversion_rate DECIMAL(5, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN attempt_count > 0 
            THEN ROUND((conversion_count::DECIMAL / attempt_count::DECIMAL) * 100, 2)
            ELSE 0 
        END
    ) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Indexes for tasks table
CREATE INDEX idx_tasks_company_id ON tasks(company_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_is_featured ON tasks(is_featured);
CREATE INDEX idx_tasks_difficulty ON tasks(difficulty);
CREATE INDEX idx_tasks_task_type ON tasks(task_type);
CREATE INDEX idx_tasks_featured_until ON tasks(featured_until);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_expires_at ON tasks(expires_at);
CREATE INDEX idx_tasks_conversion_rate ON tasks(conversion_rate);

-- Full-text search index for task titles
CREATE INDEX idx_tasks_title_search ON tasks USING gin(to_tsvector('english', title));

-- =============================================
-- TASK ATTEMPTS TABLE
-- =============================================
CREATE TABLE task_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    time_taken_seconds INT,
    is_successful BOOLEAN DEFAULT false,
    difficulty_multiplier DECIMAL(3, 2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, user_id) -- One attempt per user per task
);

-- Indexes for task_attempts table
CREATE INDEX idx_task_attempts_task_id ON task_attempts(task_id);
CREATE INDEX idx_task_attempts_user_id ON task_attempts(user_id);
CREATE INDEX idx_task_attempts_is_successful ON task_attempts(is_successful);
CREATE INDEX idx_task_attempts_created_at ON task_attempts(created_at);
CREATE INDEX idx_task_attempts_time_taken ON task_attempts(time_taken_seconds);

-- =============================================
-- USER REWARDS TABLE
-- =============================================
CREATE TABLE user_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    reward_code VARCHAR(50) UNIQUE NOT NULL,
    reward_type VARCHAR(20) NOT NULL CHECK (reward_type IN ('discount', 'coupon', 'points', 'cashback')),
    reward_value DECIMAL(10, 2) NOT NULL,
    is_redeemed BOOLEAN DEFAULT false,
    redeemed_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for user_rewards table
CREATE INDEX idx_user_rewards_user_id ON user_rewards(user_id);
CREATE INDEX idx_user_rewards_task_id ON user_rewards(task_id);
CREATE INDEX idx_user_rewards_reward_code ON user_rewards(reward_code);
CREATE INDEX idx_user_rewards_is_redeemed ON user_rewards(is_redeemed);
CREATE INDEX idx_user_rewards_expires_at ON user_rewards(expires_at);
CREATE INDEX idx_user_rewards_created_at ON user_rewards(created_at);

-- =============================================
-- PAYMENTS TABLE
-- =============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_order_id VARCHAR(255) UNIQUE NOT NULL,
    razorpay_payment_id VARCHAR(255) UNIQUE,
    company_id UUID NOT NULL REFERENCES users(id),
    payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('featured-task', 'premium-analytics', 'subscription')),
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'initiated', 'completed', 'failed', 'refunded')),
    payment_method VARCHAR(50),
    customer_email VARCHAR(255),
    customer_contact VARCHAR(20),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for payments table
CREATE INDEX idx_payments_company_id ON payments(company_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_razorpay_order_id ON payments(razorpay_order_id);
CREATE INDEX idx_payments_payment_type ON payments(payment_type);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- =============================================
-- PAYOUTS TABLE
-- =============================================
CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES users(id),
    razorpay_payout_id VARCHAR(255) UNIQUE,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'cancelled')),
    payout_period_start DATE,
    payout_period_end DATE,
    bank_account_id UUID REFERENCES bank_accounts(id),
    attempted_at TIMESTAMP,
    processed_at TIMESTAMP,
    failure_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for payouts table
CREATE INDEX idx_payouts_company_id ON payouts(company_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_razorpay_payout_id ON payouts(razorpay_payout_id);
CREATE INDEX idx_payouts_period ON payouts(payout_period_start, payout_period_end);
CREATE INDEX idx_payouts_created_at ON payouts(created_at);

-- =============================================
-- INVOICES TABLE
-- =============================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES users(id),
    payout_id UUID REFERENCES payouts(id),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    gst_amount DECIMAL(10, 2),
    net_amount DECIMAL(10, 2),
    from_date DATE,
    to_date DATE,
    pdf_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for invoices table
CREATE INDEX idx_invoices_company_id ON invoices(company_id);
CREATE INDEX idx_invoices_payout_id ON invoices(payout_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_period ON invoices(from_date, to_date);

-- =============================================
-- TRANSACTIONS TABLE
-- =============================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_entity_id UUID,
    to_entity_id UUID,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('reward-given', 'featured-paid', 'commission-earned', 'payout')),
    amount DECIMAL(10, 2) NOT NULL,
    related_task_id UUID REFERENCES tasks(id),
    related_reward_id UUID REFERENCES user_rewards(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for transactions table
CREATE INDEX idx_transactions_from_entity_id ON transactions(from_entity_id);
CREATE INDEX idx_transactions_to_entity_id ON transactions(to_entity_id);
CREATE INDEX idx_transactions_transaction_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_related_task_id ON transactions(related_task_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- =============================================
-- ANALYTICS EVENTS TABLE
-- =============================================
CREATE TABLE analytics_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id),
    task_id UUID REFERENCES tasks(id),
    company_id UUID REFERENCES users(id),
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics_events table
CREATE INDEX idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_user_id ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_task_id ON analytics_events(task_id);
CREATE INDEX idx_analytics_events_company_id ON analytics_events(company_id);
CREATE INDEX idx_analytics_events_created_at ON analytics_events(created_at);

-- Partition analytics_events table by month for better performance
CREATE TABLE analytics_events_y2024m01 PARTITION OF analytics_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- =============================================
-- ANALYTICS METRICS TABLE
-- =============================================
CREATE TABLE analytics_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('global', 'company', 'task', 'user')),
    entity_id UUID,
    metric_value DECIMAL(10, 4),
    period_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics_metrics table
CREATE INDEX idx_analytics_metrics_metric_type ON analytics_metrics(metric_type);
CREATE INDEX idx_analytics_metrics_entity_type ON analytics_metrics(entity_type);
CREATE INDEX idx_analytics_metrics_entity_id ON analytics_metrics(entity_id);
CREATE INDEX idx_analytics_metrics_period_date ON analytics_metrics(period_date);

-- =============================================
-- TRIGGERS AND FUNCTIONS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_profiles_updated_at BEFORE UPDATE ON company_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update task attempt counts
CREATE OR REPLACE FUNCTION update_task_attempt_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tasks 
        SET attempt_count = attempt_count + 1,
            conversion_count = CASE WHEN NEW.is_successful THEN conversion_count + 1 ELSE conversion_count END
        WHERE id = NEW.task_id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE tasks 
        SET conversion_count = conversion_count + 
            CASE 
                WHEN NEW.is_successful = true AND OLD.is_successful = false THEN 1
                WHEN NEW.is_successful = false AND OLD.is_successful = true THEN -1
                ELSE 0
            END
        WHERE id = NEW.task_id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Apply trigger to task_attempts
CREATE TRIGGER update_task_counts AFTER INSERT OR UPDATE ON task_attempts
    FOR EACH ROW EXECUTE FUNCTION update_task_attempt_counts();

-- =============================================
-- VIEWS FOR COMMON QUERIES
-- =============================================

-- View for active tasks with company info
CREATE VIEW active_tasks_view AS
SELECT 
    t.id, t.title, t.description, t.task_type, t.difficulty,
    t.reward_type, t.reward_value, t.reward_description, t.image_url,
    t.is_featured, t.featured_until, t.attempt_count, t.conversion_count,
    t.conversion_rate, t.created_at, t.expires_at,
    cp.company_name, cp.city, cp.logo_url,
    u.email as company_email
FROM tasks t
JOIN users u ON t.company_id = u.id
LEFT JOIN company_profiles cp ON u.id = cp.user_id
WHERE t.status = 'active';

-- View for user reward summary
CREATE VIEW user_rewards_summary_view AS
SELECT 
    ur.user_id,
    COUNT(*) as total_rewards,
    COUNT(CASE WHEN ur.is_redeemed = false THEN 1 END) as unredeemed_rewards,
    COUNT(CASE WHEN ur.is_redeemed = true THEN 1 END) as redeemed_rewards,
    COALESCE(SUM(ur.reward_value), 0) as total_reward_value,
    COALESCE(SUM(CASE WHEN ur.is_redeemed = false THEN ur.reward_value ELSE 0 END), 0) as unredeemed_value
FROM user_rewards ur
GROUP BY ur.user_id;

-- View for company performance metrics
CREATE VIEW company_performance_view AS
SELECT 
    t.company_id,
    COUNT(DISTINCT t.id) as total_tasks,
    COUNT(DISTINCT CASE WHEN t.status = 'active' THEN t.id END) as active_tasks,
    COUNT(ta.id) as total_attempts,
    COUNT(CASE WHEN ta.is_successful THEN 1 END) as successful_attempts,
    ROUND(
        COUNT(CASE WHEN ta.is_successful THEN 1 END)::float / 
        NULLIF(COUNT(ta.id), 0) * 100, 2
    ) as conversion_rate,
    COALESCE(SUM(t.reward_value), 0) as total_rewards_offered
FROM tasks t
LEFT JOIN task_attempts ta ON t.id = ta.task_id
GROUP BY t.company_id;

-- =============================================
-- INITIAL DATA AND CONSTRAINTS
-- =============================================

-- Add check constraints for data integrity
ALTER TABLE tasks ADD CONSTRAINT chk_reward_value_positive CHECK (reward_value > 0);
ALTER TABLE payments ADD CONSTRAINT chk_payment_amount_positive CHECK (amount > 0);
ALTER TABLE payouts ADD CONSTRAINT chk_payout_amount_positive CHECK (amount > 0);
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_amount_positive CHECK (amount > 0);

-- Add comments for documentation
COMMENT ON TABLE users IS 'Core user accounts table with authentication and role management';
COMMENT ON TABLE tokens IS 'JWT and verification tokens for authentication';
COMMENT ON TABLE user_profiles IS 'Extended user profile information';
COMMENT ON TABLE company_profiles IS 'Company-specific information and KYC details';
COMMENT ON TABLE bank_accounts IS 'Bank account information for payouts';
COMMENT ON TABLE tasks IS 'Main tasks/puzzles created by companies';
COMMENT ON TABLE task_attempts IS 'User attempts to complete tasks';
COMMENT ON TABLE user_rewards IS 'Rewards earned by users for completing tasks';
COMMENT ON TABLE payments IS 'Payment transactions via Razorpay';
COMMENT ON TABLE payouts IS 'Payout transactions to companies';
COMMENT ON TABLE invoices IS 'Generated invoices for companies';
COMMENT ON TABLE transactions IS 'General transaction ledger';
COMMENT ON TABLE analytics_events IS 'Analytics event tracking';
COMMENT ON TABLE analytics_metrics IS 'Aggregated analytics metrics';

-- Create default admin user (password: Admin123!)
INSERT INTO users (email, password_hash, role, is_active, is_verified)
VALUES (
    'admin@taskloot.com',
    '$2b$10$rQZ8ZqGqJqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqKqK', -- This is a placeholder hash
    'admin',
    true,
    true
) ON CONFLICT (email) DO NOTHING;
