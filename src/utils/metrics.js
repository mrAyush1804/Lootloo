const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});

const databaseConnections = new promClient.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections'
});

const cacheHitRate = new promClient.Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate percentage'
});

const taskAttemptsTotal = new promClient.Counter({
  name: 'task_attempts_total',
  help: 'Total number of task attempts',
  labelNames: ['task_id', 'user_id', 'is_successful']
});

const taskAttemptsSuccessful = new promClient.Counter({
  name: 'task_attempts_successful_total',
  help: 'Total number of successful task attempts',
  labelNames: ['task_id', 'user_id']
});

const tasksPublishedTotal = new promClient.Counter({
  name: 'tasks_published_total',
  help: 'Total number of tasks published',
  labelNames: ['company_id', 'task_type', 'difficulty']
});

const userRegistrationsTotal = new promClient.Counter({
  name: 'user_registrations_total',
  help: 'Total number of user registrations',
  labelNames: ['role']
});

const loginAttemptsTotal = new promClient.Counter({
  name: 'login_attempts_total',
  help: 'Total number of login attempts',
  labelNames: ['success']
});

const loginFailuresTotal = new promClient.Counter({
  name: 'login_failures_total',
  help: 'Total number of login failures',
  labelNames: ['reason']
});

const paymentProcessingTotal = new promClient.Counter({
  name: 'payment_processing_total',
  help: 'Total number of payment processing attempts',
  labelNames: ['payment_type', 'status']
});

const paymentFailuresTotal = new promClient.Counter({
  name: 'payment_failures_total',
  help: 'Total number of payment failures',
  labelNames: ['payment_type', 'error_code']
});

const rewardsRedeemedTotal = new promClient.Counter({
  name: 'rewards_redeemed_total',
  help: 'Total number of rewards redeemed',
  labelNames: ['reward_type', 'company_id']
});

const suspiciousRequestsTotal = new promClient.Counter({
  name: 'suspicious_requests_total',
  help: 'Total number of suspicious requests',
  labelNames: ['ip', 'user_agent', 'pattern']
});

const businessEventsTotal = new promClient.Counter({
  name: 'business_events_total',
  help: 'Total number of business events',
  labelNames: ['event_type', 'entity_type', 'entity_id']
});

// Register all metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(activeConnections);
register.registerMetric(databaseConnections);
register.registerMetric(cacheHitRate);
register.registerMetric(taskAttemptsTotal);
register.registerMetric(taskAttemptsSuccessful);
register.registerMetric(tasksPublishedTotal);
register.registerMetric(userRegistrationsTotal);
register.registerMetric(loginAttemptsTotal);
register.registerMetric(loginFailuresTotal);
register.registerMetric(paymentProcessingTotal);
register.registerMetric(paymentFailuresTotal);
register.registerMetric(rewardsRedeemedTotal);
register.registerMetric(suspiciousRequestsTotal);
register.registerMetric(businessEventsTotal);

// Middleware to track HTTP requests
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Increment active connections
  activeConnections.inc();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;
    const method = req.method;
    const statusCode = res.statusCode;
    
    // Record metrics
    httpRequestDuration
      .labels(method, route, statusCode)
      .observe(duration);
    
    httpRequestTotal
      .labels(method, route, statusCode)
      .inc();
    
    // Decrement active connections
    activeConnections.dec();
  });
  
  next();
};

// Helper functions to record metrics
const recordTaskAttempt = (taskId, userId, isSuccessful) => {
  taskAttemptsTotal
    .labels(taskId, userId, isSuccessful.toString())
    .inc();
  
  if (isSuccessful) {
    taskAttemptsSuccessful
      .labels(taskId, userId)
      .inc();
  }
};

const recordTaskPublished = (companyId, taskType, difficulty) => {
  tasksPublishedTotal
    .labels(companyId, taskType, difficulty)
    .inc();
};

const recordUserRegistration = (role) => {
  userRegistrationsTotal
    .labels(role)
    .inc();
};

const recordLoginAttempt = (success) => {
  loginAttemptsTotal
    .labels(success.toString())
    .inc();
};

const recordLoginFailure = (reason) => {
  loginFailuresTotal
    .labels(reason)
    .inc();
};

const recordPaymentProcessing = (paymentType, status) => {
  paymentProcessingTotal
    .labels(paymentType, status)
    .inc();
};

const recordPaymentFailure = (paymentType, errorCode) => {
  paymentFailuresTotal
    .labels(paymentType, errorCode)
    .inc();
};

const recordRewardRedeemed = (rewardType, companyId) => {
  rewardsRedeemedTotal
    .labels(rewardType, companyId)
    .inc();
};

const recordSuspiciousRequest = (ip, userAgent, pattern) => {
  suspiciousRequestsTotal
    .labels(ip, userAgent, pattern)
    .inc();
};

const recordBusinessEvent = (eventType, entityType, entityId) => {
  businessEventsTotal
    .labels(eventType, entityType, entityId)
    .inc();
};

const updateDatabaseConnections = (count) => {
  databaseConnections.set(count);
};

const updateCacheHitRate = (hitRate) => {
  cacheHitRate.set(hitRate);
};

// Metrics endpoint
const metricsEndpoint = async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

module.exports = {
  register,
  metricsMiddleware,
  metricsEndpoint,
  recordTaskAttempt,
  recordTaskPublished,
  recordUserRegistration,
  recordLoginAttempt,
  recordLoginFailure,
  recordPaymentProcessing,
  recordPaymentFailure,
  recordRewardRedeemed,
  recordSuspiciousRequest,
  recordBusinessEvent,
  updateDatabaseConnections,
  updateCacheHitRate,
  // Export individual metrics for testing
  httpRequestDuration,
  httpRequestTotal,
  activeConnections,
  databaseConnections,
  cacheHitRate
};
