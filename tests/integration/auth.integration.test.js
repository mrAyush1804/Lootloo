const request = require('supertest');
const app = require('../../src/index');
const { connectDatabase, query } = require('../../src/database/connection');
const { connectRedis } = require('../../src/cache/redis');

describe('Authentication Integration Tests', () => {
  let server;

  beforeAll(async () => {
    // Setup test database and Redis
    await connectDatabase();
    await connectRedis();
    
    // Start test server
    server = app.listen(0); // Use random port
  });

  afterAll(async () => {
    // Cleanup
    if (server) {
      server.close();
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await query('DELETE FROM users WHERE email LIKE $1', ['test%@example.com']);
  });

  describe('POST /api/v1/auth/register', () => {
    test('should register new user successfully', async () => {
      const userData = {
        email: 'test-register@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user.email).toBe(userData.email);
      expect(response.body.data.user.role).toBe(userData.role);
      expect(response.body.data.tokens).toHaveProperty('accessToken');
      expect(response.body.data.tokens).toHaveProperty('refreshToken');
    });

    test('should reject duplicate email', async () => {
      const userData = {
        email: 'test-duplicate@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      // First registration should succeed
      await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      // Second registration should fail
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    test('should reject weak password', async () => {
      const userData = {
        email: 'test-weak@example.com',
        password: 'weak',
        role: 'player',
        name: 'Test User'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(422);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject invalid role', async () => {
      const userData = {
        email: 'test-invalid-role@example.com',
        password: 'SecurePass123!',
        role: 'invalid-role',
        name: 'Test User'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(422);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      // Create a test user for login tests
      const registerData = {
        email: 'test-login@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(registerData);

      testUser = registerResponse.body.data.user;
    });

    test('should login with valid credentials', async () => {
      const loginData = {
        email: 'test-login@example.com',
        password: 'SecurePass123!'
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data.user.email).toBe(loginData.email);
    });

    test('should reject invalid password', async () => {
      const loginData = {
        email: 'test-login@example.com',
        password: 'WrongPassword123!'
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'SecurePass123!'
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh-token', () => {
    let refreshToken;

    beforeEach(async () => {
      // Create and login a user to get refresh token
      const registerData = {
        email: 'test-refresh@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      await request(app)
        .post('/api/v1/auth/register')
        .send(registerData);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test-refresh@example.com',
          password: 'SecurePass123!'
        });

      refreshToken = loginResponse.body.data.tokens.refreshToken;
    });

    test('should refresh access token with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refresh_token: refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
    });

    test('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refresh_token: 'invalid-refresh-token' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject missing refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let accessToken;
    let testUser;

    beforeEach(async () => {
      // Create and login a user to get access token
      const registerData = {
        email: 'test-me@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(registerData);

      testUser = registerResponse.body.data.user;
      accessToken = registerResponse.body.data.tokens.accessToken;
    });

    test('should get current user info with valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testUser.id);
      expect(response.body.data.email).toBe(testUser.email);
      expect(response.body.data.role).toBe(testUser.role);
    });

    test('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    let accessToken;

    beforeEach(async () => {
      // Create and login a user to get access token
      const registerData = {
        email: 'test-logout@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(registerData);

      accessToken = registerResponse.body.data.tokens.accessToken;
    });

    test('should logout successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Logged out successfully');
    });

    test('should reject logout without token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    test('should process forgot password request', async () => {
      // Create a user first
      const registerData = {
        email: 'test-forgot@example.com',
        password: 'SecurePass123!',
        role: 'player',
        name: 'Test User'
      };

      await request(app)
        .post('/api/v1/auth/register')
        .send(registerData);

      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'test-forgot@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('If the email exists');
    });

    test('should handle non-existent email gracefully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('If the email exists');
    });
  });
});
