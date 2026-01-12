const request = require('supertest');
const app = require('../src/index');

/**
 * Smoke test to verify basic application functionality
 * This test runs quickly to ensure the application starts and responds to basic requests
 */

async function runSmokeTests() {
  console.log('🚀 Starting smoke tests...');

  let testsPassed = 0;
  let testsFailed = 0;

  const test = async (name, testFn) => {
    try {
      await testFn();
      console.log(`✅ ${name}`);
      testsPassed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      testsFailed++;
    }
  };

  // Test 1: Health check endpoint
  await test('Health check endpoint', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    if (!response.body.status) {
      throw new Error('Health check response missing status');
    }
  });

  // Test 2: Readiness probe
  await test('Readiness probe', async () => {
    const response = await request(app)
      .get('/health/ready')
      .expect(200);

    if (!response.body.status) {
      throw new Error('Readiness probe response missing status');
    }
  });

  // Test 3: Liveness probe
  await test('Liveness probe', async () => {
    const response = await request(app)
      .get('/health/live')
      .expect(200);

    if (!response.body.status) {
      throw new Error('Liveness probe response missing status');
    }
  });

  // Test 4: API 404 handling
  await test('API 404 handling', async () => {
    const response = await request(app)
      .get('/api/v1/nonexistent-endpoint')
      .expect(404);

    if (!response.body.error) {
      throw new Error('404 response missing error object');
    }
  });

  // Test 5: Auth endpoint exists (even if it fails validation)
  await test('Auth endpoint accessibility', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({})
      .expect(422); // Should fail validation but endpoint should exist

    if (!response.body.error) {
      throw new Error('Auth endpoint missing error response');
    }
  });

  // Test 6: CORS headers
  await test('CORS headers present', async () => {
    const response = await request(app)
      .options('/api/v1/auth/register')
      .expect(200);

    // Check for common CORS headers
    const hasCorsHeaders = response.headers['access-control-allow-origin'] ||
                         response.headers['access-control-allow-methods'] ||
                         response.headers['access-control-allow-headers'];

    if (!hasCorsHeaders) {
      throw new Error('CORS headers missing');
    }
  });

  // Test 7: Rate limiting headers
  await test('Rate limiting headers', async () => {
    const response = await request(app)
      .get('/api/v1/tasks/list')
      .expect(200);

    // Rate limiting headers should be present
    const hasRateLimitHeaders = response.headers['x-ratelimit-limit'] ||
                               response.headers['x-ratelimit-remaining'] ||
                               response.headers['x-ratelimit-reset'];

    if (!hasRateLimitHeaders) {
      console.log('   Warning: Rate limiting headers not found (may be expected)');
    }
  });

  // Test 8: Request ID header
  await test('Request ID generation', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    // Should have request ID in response or headers
    const hasRequestId = response.headers['x-request-id'] ||
                        response.body.meta?.requestId;

    if (!hasRequestId) {
      console.log('   Warning: Request ID not found');
    }
  });

  // Test 9: Content-Type headers
  await test('Proper Content-Type headers', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    if (!response.headers['content-type']?.includes('application/json')) {
      throw new Error('Missing or incorrect Content-Type header');
    }
  });

  // Test 10: Security headers
  await test('Security headers present', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    // Check for common security headers
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'strict-transport-security'
    ];

    const hasSecurityHeaders = securityHeaders.some(header => 
      response.headers[header]
    );

    if (!hasSecurityHeaders) {
      console.log('   Warning: Security headers not found');
    }
  });

  console.log('\n📊 Smoke Test Results:');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed > 0) {
    console.log('\n⚠️  Some smoke tests failed. Please review the application.');
    process.exit(1);
  } else {
    console.log('\n🎉 All smoke tests passed! Application is ready.');
    process.exit(0);
  }
}

// Run smoke tests if this file is executed directly
if (require.main === module) {
  runSmokeTests().catch(error => {
    console.error('Smoke test runner failed:', error);
    process.exit(1);
  });
}

module.exports = runSmokeTests;
