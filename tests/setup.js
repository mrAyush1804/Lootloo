// Test setup file
const { beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/taskloot_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
process.env.JWT_PRIVATE_KEY = 'test-private-key';
process.env.JWT_PUBLIC_KEY = 'test-public-key';
process.env.RAZORPAY_KEY_ID = 'test-key-id';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET = 'test-bucket';

// Global test setup
beforeAll(async () => {
  // Global setup before all tests
  console.log('🧪 Setting up test environment...');
});

afterAll(async () => {
  // Global cleanup after all tests
  console.log('🧹 Cleaning up test environment...');
});

beforeEach(async () => {
  // Setup before each test
});

afterEach(async () => {
  // Cleanup after each test
});

// Mock console methods to reduce noise in tests
const originalConsole = global.console;

beforeAll(() => {
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Mock external services
jest.mock('razorpay', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    orders: {
      create: jest.fn(),
      fetch: jest.fn()
    },
    payments: {
      fetch: jest.fn()
    },
    payouts: {
      create: jest.fn()
    }
  }))
}));

jest.mock('aws-sdk', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    S3: jest.fn(() => ({
      upload: jest.fn(() => ({
        promise: jest.fn()
      })),
      deleteObjects: jest.fn(() => ({
        promise: jest.fn()
      }))
    }))
  }))
}));

// Global test utilities
global.testUtils = {
  // Generate test UUID
  generateUUID: () => '00000000-0000-0000-0000-000000000000',
  
  // Generate test email
  generateEmail: (prefix = 'test') => `${prefix}-${Date.now()}@example.com`,
  
  // Generate test token
  generateToken: () => 'test-jwt-token',
  
  // Wait for async operations
  wait: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
};
