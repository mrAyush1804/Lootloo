const authService = require('../../src/services/auth/service');
const { ValidationError, ConflictError, UnauthorizedError } = require('../../src/middleware/errorHandler');

// Mock dependencies
jest.mock('../../src/database/connection');
jest.mock('../../src/cache/redis');
jest.mock('../../src/utils/logger');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePassword', () => {
    test('should accept valid password', () => {
      const validPassword = 'SecurePass123!';
      expect(() => authService.validatePassword(validPassword)).not.toThrow();
    });

    test('should reject password that is too short', () => {
      const shortPassword = 'Short1!';
      expect(() => authService.validatePassword(shortPassword))
        .toThrow(ValidationError);
    });

    test('should reject password without uppercase', () => {
      const noUpperCase = 'securepass123!';
      expect(() => authService.validatePassword(noUpperCase))
        .toThrow(ValidationError);
    });

    test('should reject password without lowercase', () => {
      const noLowerCase = 'SECUREPASS123!';
      expect(() => authService.validatePassword(noLowerCase))
        .toThrow(ValidationError);
    });

    test('should reject password without numbers', () => {
      const noNumbers = 'SecurePass!';
      expect(() => authService.validatePassword(noNumbers))
        .toThrow(ValidationError);
    });

    test('should reject password without special characters', () => {
      const noSpecial = 'SecurePass123';
      expect(() => authService.validatePassword(noSpecial))
        .toThrow(ValidationError);
    });
  });

  describe('validateEmail', () => {
    test('should accept valid email', () => {
      const validEmail = 'test@example.com';
      expect(() => authService.validateEmail(validEmail)).not.toThrow();
    });

    test('should reject invalid email', () => {
      const invalidEmail = 'invalid-email';
      expect(() => authService.validateEmail(invalidEmail))
        .toThrow(ValidationError);
    });
  });

  describe('generateTokens', () => {
    test('should generate access and refresh tokens', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'player'
      };

      const tokens = authService.generateTokens(user);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });
  });

  describe('hashPassword', () => {
    test('should hash password successfully', async () => {
      const password = 'SecurePass123!';
      const hash = await authService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
    });

    test('should reject weak password', async () => {
      const weakPassword = 'weak';
      await expect(authService.hashPassword(weakPassword))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('verifyPassword', () => {
    test('should verify correct password', async () => {
      const password = 'SecurePass123!';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'SecurePass123!';
      const wrongPassword = 'WrongPass123!';
      const hash = await authService.hashPassword(password);

      const isValid = await authService.verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });
  });

  describe('verifyToken', () => {
    test('should verify valid token', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'player'
      };

      const { accessToken } = authService.generateTokens(user);
      const decoded = authService.verifyToken(accessToken);

      expect(decoded.sub).toBe(user.id);
      expect(decoded.email).toBe(user.email);
      expect(decoded.role).toBe(user.role);
    });

    test('should reject invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => authService.verifyToken(invalidToken))
        .toThrow(UnauthorizedError);
    });
  });

  describe('checkLoginRateLimit', () => {
    test('should allow login within rate limit', async () => {
      const email = 'test@example.com';
      const ip = '127.0.0.1';

      // Mock cache service to return allowed response
      const { cacheService } = require('../../src/cache/redis');
      cacheService.checkRateLimit = jest.fn().mockResolvedValue({
        allowed: true,
        remaining: 4
      });

      await expect(authService.checkLoginRateLimit(email, ip))
        .resolves.toBe(true);
    });

    test('should block login when rate limit exceeded', async () => {
      const email = 'test@example.com';
      const ip = '127.0.0.1';

      // Mock cache service to return blocked response
      const { cacheService } = require('../../src/cache/redis');
      cacheService.checkRateLimit = jest.fn().mockResolvedValue({
        allowed: false,
        remaining: 0
      });

      await expect(authService.checkLoginRateLimit(email, ip))
        .rejects.toThrow();
    });
  });

  describe('generateRewardCode', () => {
    test('should generate unique reward code', () => {
      const code1 = authService.generateRewardCode();
      const code2 = authService.generateRewardCode();

      expect(typeof code1).toBe('string');
      expect(typeof code2).toBe('string');
      expect(code1).not.toBe(code2);
      expect(code1).toMatch(/^TL/); // Should start with TL
    });
  });

  describe('hashToken', () => {
    test('should hash token successfully', async () => {
      const token = 'test-token';
      const hash = await authService.hashToken(token);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(token);
    });
  });

  describe('isTokenBlacklisted', () => {
    test('should check if token is blacklisted', async () => {
      const token = 'test-token';

      // Mock cache service
      const { cacheService } = require('../../src/cache/redis');
      cacheService.exists = jest.fn().mockResolvedValue(false);

      const isBlacklisted = await authService.isTokenBlacklisted(token);
      expect(isBlacklisted).toBe(false);
      expect(cacheService.exists).toHaveBeenCalledWith(`auth:blacklist:${token}`);
    });
  });
});
