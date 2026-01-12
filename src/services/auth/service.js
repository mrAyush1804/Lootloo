const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../../database/connection');
const { cacheService } = require('../../cache/redis');
const logger = require('../../utils/logger');
const {
  ValidationError,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  RateLimitError
} = require('../../middleware/errorHandler');

class AuthService {
  constructor() {
    this.jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
    this.jwtPublicKey = process.env.JWT_PUBLIC_KEY;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
    this.refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
  }

  // Password validation
  validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    if (!hasUpperCase) {
      throw new ValidationError('Password must contain at least one uppercase letter');
    }

    if (!hasLowerCase) {
      throw new ValidationError('Password must contain at least one lowercase letter');
    }

    if (!hasNumbers) {
      throw new ValidationError('Password must contain at least one number');
    }

    if (!hasSpecialChar) {
      throw new ValidationError('Password must contain at least one special character');
    }

    return true;
  }

  // Email validation
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }
    return true;
  }

  // Phone validation (Indian format)
  validatePhone(phone) {
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      throw new ValidationError('Invalid phone number format');
    }
    return true;
  }

  // Hash password
  async hashPassword(password) {
    this.validatePassword(password);
    return await bcrypt.hash(password, this.bcryptRounds);
  }

  // Verify password
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  // Generate JWT tokens
  generateTokens(user) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      aud: 'taskloot-api'
    };

    const accessToken = jwt.sign(payload, this.jwtPrivateKey, {
      algorithm: 'RS256',
      expiresIn: this.jwtExpiresIn
    });

    const refreshTokenPayload = {
      sub: user.id,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    };

    const refreshToken = jwt.sign(refreshTokenPayload, this.jwtPrivateKey, {
      algorithm: 'RS256',
      expiresIn: this.refreshTokenExpiresIn
    });

    return { accessToken, refreshToken };
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtPublicKey, {
        algorithms: ['RS256'],
        audience: 'taskloot-api'
      });
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedError('Invalid token');
      } else {
        throw new UnauthorizedError('Token verification failed');
      }
    }
  }

  // Check rate limiting for login attempts
  async checkLoginRateLimit(email, ip) {
    const emailKey = `auth:login_attempts:email:${email}`;
    const ipKey = `auth:login_attempts:ip:${ip}`;

    const emailLimit = await cacheService.checkRateLimit(emailKey, 5, 900); // 5 attempts per 15 minutes
    const ipLimit = await cacheService.checkRateLimit(ipKey, 20, 900); // 20 attempts per 15 minutes per IP

    if (!emailLimit.allowed || !ipLimit.allowed) {
      logger.security('Login rate limit exceeded', { email, ip });
      throw new RateLimitError('Too many login attempts. Please try again later');
    }

    return true;
  }

  // Register new user
  async register(userData) {
    const { email, password, role, name, phone } = userData;

    // Validate inputs
    this.validateEmail(email);
    this.validatePhone(phone);

    if (!['player', 'company'].includes(role)) {
      throw new ValidationError('Invalid role. Must be player or company');
    }

    if (!name || name.length < 2 || name.length > 100) {
      throw new ValidationError('Name must be between 2 and 100 characters');
    }

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 OR (phone = $2 AND phone IS NOT NULL)',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      throw new ConflictError('User with this email or phone already exists');
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Generate verification token
    const verificationToken = uuidv4();

    // Create user in database
    const result = await query(
      `INSERT INTO users (email, phone, password_hash, role, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, is_verified, created_at`,
      [email, phone, passwordHash, role, verificationToken, false]
    );

    const user = result.rows[0];

    // Create user profile
    await query(
      `INSERT INTO user_profiles (user_id, first_name, last_name)
       VALUES ($1, $2, $3)`,
      [user.id, name.split(' ')[0], name.split(' ').slice(1).join(' ')]
    );

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Store refresh token in database
    const refreshTokenHash = await this.hashToken(tokens.refreshToken);
    await query(
      `INSERT INTO tokens (user_id, token_type, token_hash, expires_at)
       VALUES ($1, 'refresh', $2, $3)`,
      [user.id, refreshTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    logger.business('User registered', { userId: user.id, email, role });

    // TODO: Send verification email
    // await emailService.sendVerificationEmail(email, verificationToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at
      },
      tokens
    };
  }

  // Login user
  async login(email, password, ip) {
    this.validateEmail(email);

    // Check rate limiting
    await this.checkLoginRateLimit(email, ip);

    // Find user
    const result = await query(
      `SELECT id, email, password_hash, role, is_active, is_verified, last_login
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      throw new UnauthorizedError('Account is deactivated');
    }

    // Verify password
    const isPasswordValid = await this.verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update last login
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Store refresh token
    const refreshTokenHash = await this.hashToken(tokens.refreshToken);
    await query(
      `INSERT INTO tokens (user_id, token_type, token_hash, expires_at)
       VALUES ($1, 'refresh', $2, $3)`,
      [user.id, refreshTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    logger.business('User logged in', { userId: user.id, email, ip });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        lastLogin: user.last_login
      },
      tokens
    };
  }

  // Refresh access token
  async refreshToken(refreshToken) {
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    // Verify refresh token
    const decoded = this.verifyToken(refreshToken);
    
    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Get user from database
    const userResult = await query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (userResult.rows.length === 0) {
      throw new UnauthorizedError('User not found');
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      throw new UnauthorizedError('Account is deactivated');
    }

    // Verify refresh token exists in database
    const tokenResult = await query(
      `SELECT id, is_revoked, expires_at FROM tokens 
       WHERE user_id = $1 AND token_type = 'refresh' AND is_revoked = false`,
      [user.id]
    );

    if (tokenResult.rows.length === 0) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const tokenRecord = tokenResult.rows[0];

    if (new Date() > tokenRecord.expires_at) {
      throw new UnauthorizedError('Refresh token expired');
    }

    // Generate new tokens
    const tokens = this.generateTokens(user);

    // Revoke old refresh token
    await query(
      'UPDATE tokens SET is_revoked = true WHERE id = $1',
      [tokenRecord.id]
    );

    // Store new refresh token
    const refreshTokenHash = await this.hashToken(tokens.refreshToken);
    await query(
      `INSERT INTO tokens (user_id, token_type, token_hash, expires_at)
       VALUES ($1, 'refresh', $2, $3)`,
      [user.id, refreshTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    return tokens;
  }

  // Logout user
  async logout(userId, token) {
    // Revoke access token by adding to blacklist
    const decoded = this.verifyToken(token);
    const blacklistKey = `auth:blacklist:${token}`;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    
    if (ttl > 0) {
      await cacheService.set(blacklistKey, true, ttl);
    }

    // Revoke all refresh tokens for user
    await query(
      'UPDATE tokens SET is_revoked = true WHERE user_id = $1 AND token_type = \'refresh\'',
      [userId]
    );

    logger.business('User logged out', { userId });

    return { success: true };
  }

  // Hash token for storage
  async hashToken(token) {
    return await bcrypt.hash(token, 10);
  }

  // Check if token is blacklisted
  async isTokenBlacklisted(token) {
    const blacklistKey = `auth:blacklist:${token}`;
    return await cacheService.exists(blacklistKey);
  }

  // Forgot password
  async forgotPassword(email) {
    this.validateEmail(email);

    const result = await query(
      'SELECT id, email FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists or not
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const user = result.rows[0];
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token
    const tokenHash = await this.hashToken(resetToken);
    await query(
      `INSERT INTO tokens (user_id, token_type, token_hash, expires_at)
       VALUES ($1, 'reset', $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    // TODO: Send reset password email
    // await emailService.sendPasswordResetEmail(email, resetToken);

    logger.business('Password reset requested', { userId: user.id, email });

    return { message: 'If the email exists, a reset link has been sent' };
  }

  // Reset password
  async resetPassword(resetToken, newPassword) {
    this.validatePassword(newPassword);

    // Find valid reset token
    const tokenResult = await query(
      `SELECT t.user_id, t.expires_at, u.email FROM tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token_type = 'reset' AND t.is_revoked = false`,
      []
    );

    // This is simplified - in production, you'd need to verify the token hash
    const validToken = tokenResult.rows.find(token => {
      // TODO: Verify token hash against stored hash
      return true; // Placeholder
    });

    if (!validToken) {
      throw new UnauthorizedError('Invalid or expired reset token');
    }

    if (new Date() > validToken.expires_at) {
      throw new UnauthorizedError('Reset token has expired');
    }

    // Hash new password
    const passwordHash = await this.hashPassword(newPassword);

    // Update password in transaction
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, validToken.user_id]
      );

      await client.query(
        'UPDATE tokens SET is_revoked = true WHERE user_id = $1 AND token_type = \'reset\'',
        [validToken.user_id]
      );
    });

    logger.business('Password reset completed', { userId: validToken.user_id, email: validToken.email });

    return { success: true };
  }

  // Verify email
  async verifyEmail(verificationToken) {
    const result = await query(
      `SELECT u.id, u.email FROM users u
       WHERE u.verification_token = $1 AND u.is_verified = false`,
      [verificationToken]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }

    const user = result.rows[0];

    await query(
      'UPDATE users SET is_verified = true, verification_token = NULL WHERE id = $1',
      [user.id]
    );

    logger.business('Email verified', { userId: user.id, email: user.email });

    return { success: true };
  }
}

module.exports = new AuthService();
