const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which level to log based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}${
      info.stack ? '\n' + info.stack : ''
    }${
      info.metadata && Object.keys(info.metadata).length > 0 
        ? '\n' + JSON.stringify(info.metadata, null, 2) 
        : ''
    }`
  ),
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false,
});

// Add request ID tracking
logger.addRequestContext = (req) => {
  return logger.child({
    requestId: req.id || 'unknown',
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
};

// Add performance tracking
logger.performance = (operation, duration, metadata = {}) => {
  logger.info(`Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...metadata
  });
};

// Add security event logging
logger.security = (event, metadata = {}) => {
  logger.warn(`Security Event: ${event}`, {
    event,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

// Add business event logging
logger.business = (event, metadata = {}) => {
  logger.info(`Business Event: ${event}`, {
    event,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

// Add API error logging
logger.apiError = (error, req, additionalInfo = {}) => {
  logger.error('API Error', {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query
    },
    user: req.user ? { id: req.user.sub, email: req.user.email } : null,
    ...additionalInfo
  });
};

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = logger;
