const logger = require('../utils/logger');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

class GoneError extends AppError {
  constructor(message = 'Resource is no longer available') {
    super(message, 410, 'GONE');
  }
}

class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
  }
}

class SecurityError extends AppError {
  constructor(message = 'Security violation detected') {
    super(message, 403, 'SECURITY_ERROR');
  }
}

// Error response formatter
const formatErrorResponse = (error, req) => {
  const response = {
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred',
      status: error.statusCode || 500
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown'
    }
  };

  // Add validation details if available
  if (error instanceof ValidationError && error.details) {
    response.error.details = error.details;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
  }

  return response;
};

// Main error handler middleware
const errorHandler = (error, req, res, next) => {
  let err = error;

  // Convert non-operational errors to AppError
  if (!(error instanceof AppError)) {
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Internal server error';
    err = new AppError(message, statusCode);
  }

  // Log the error
  logger.apiError(err, req);

  // Handle specific error types
  if (err.name === 'ValidationError') {
    err = new ValidationError(err.message, err.details);
  } else if (err.name === 'CastError') {
    err = new ValidationError('Invalid ID format');
  } else if (err.code === '23505') { // PostgreSQL unique violation
    err = new ConflictError('Resource already exists');
  } else if (err.code === '23503') { // PostgreSQL foreign key violation
    err = new ValidationError('Referenced resource does not exist');
  } else if (err.code === '23502') { // PostgreSQL not null violation
    err = new ValidationError('Required field is missing');
  } else if (err.name === 'JsonWebTokenError') {
    err = new UnauthorizedError('Invalid token');
  } else if (err.name === 'TokenExpiredError') {
    err = new UnauthorizedError('Token expired');
  } else if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      err = new ValidationError('File size too large');
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      err = new ValidationError('Too many files');
    } else {
      err = new ValidationError('File upload error');
    }
  }

  // Send error response
  const errorResponse = formatErrorResponse(err, req);
  res.status(err.statusCode || 500).json(errorResponse);
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Validation error handler for Joi
const handleJoiError = (error) => {
  const details = error.details.map(detail => ({
    field: detail.path.join('.'),
    message: detail.message,
    value: detail.context?.value
  }));

  return new ValidationError('Validation failed', details);
};

module.exports = {
  errorHandler,
  asyncHandler,
  handleJoiError,
  // Error classes
  AppError,
  ValidationError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  GoneError,
  InternalError,
  SecurityError
};
