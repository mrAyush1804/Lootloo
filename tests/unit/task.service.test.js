const taskService = require('../../src/services/tasks/service');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../../src/middleware/errorHandler');

// Mock dependencies
jest.mock('../../src/database/connection');
jest.mock('../../src/cache/redis');
jest.mock('../../src/services/tasks/puzzleGenerator');
jest.mock('../../src/utils/logger');

describe('TaskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateTaskData', () => {
    test('should accept valid task data', () => {
      const validData = {
        title: 'Test Task',
        description: 'A test task description',
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 10.99,
        reward_description: '10% discount on next purchase'
      };

      expect(() => taskService.validateTaskData(validData)).not.toThrow();
    });

    test('should reject invalid title', () => {
      const invalidData = {
        title: 'AB', // Too short
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 10.99,
        reward_description: 'Valid description'
      };

      expect(() => taskService.validateTaskData(invalidData))
        .toThrow(ValidationError);
    });

    test('should reject invalid task type', () => {
      const invalidData = {
        title: 'Valid Task Title',
        task_type: 'invalid-type',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 10.99,
        reward_description: 'Valid description'
      };

      expect(() => taskService.validateTaskData(invalidData))
        .toThrow(ValidationError);
    });

    test('should reject negative reward value', () => {
      const invalidData = {
        title: 'Valid Task Title',
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: -10.99,
        reward_description: 'Valid description'
      };

      expect(() => taskService.validateTaskData(invalidData))
        .toThrow(ValidationError);
    });

    test('should reject invalid reward description', () => {
      const invalidData = {
        title: 'Valid Task Title',
        task_type: 'image-puzzle',
        difficulty: 'easy',
        reward_type: 'discount',
        reward_value: 10.99,
        reward_description: 'Too short' // Less than 10 characters
      };

      expect(() => taskService.validateTaskData(invalidData))
        .toThrow(ValidationError);
    });
  });

  describe('getGridSizeFromDifficulty', () => {
    test('should return correct grid size for easy difficulty', () => {
      expect(taskService.getGridSizeFromDifficulty('easy')).toBe(9);
    });

    test('should return correct grid size for medium difficulty', () => {
      expect(taskService.getGridSizeFromDifficulty('medium')).toBe(16);
    });

    test('should return correct grid size for hard difficulty', () => {
      expect(taskService.getGridSizeFromDifficulty('hard')).toBe(25);
    });

    test('should return correct grid size for expert difficulty', () => {
      expect(taskService.getGridSizeFromDifficulty('expert')).toBe(25);
    });

    test('should return default grid size for invalid difficulty', () => {
      expect(taskService.getGridSizeFromDifficulty('invalid')).toBe(16);
    });
  });

  describe('listTasks', () => {
    test('should return tasks with default filters', async () => {
      const mockTasks = [
        { id: '1', title: 'Task 1' },
        { id: '2', title: 'Task 2' }
      ];

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 2 }] });
        }
        return Promise.resolve({ rows: mockTasks });
      });

      const result = await taskService.listTasks();

      expect(result).toHaveProperty('tasks');
      expect(result).toHaveProperty('pagination');
      expect(result.tasks).toEqual(mockTasks);
      expect(result.pagination.current_page).toBe(1);
    });

    test('should apply filters correctly', async () => {
      const filters = {
        page: 2,
        limit: 10,
        difficulty: 'easy',
        task_type: 'image-puzzle'
      };

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ total: 5 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await taskService.listTasks(filters);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE t.status = $1'),
        expect.arrayContaining(['active', 'easy', 'image-puzzle'])
      );
    });
  });

  describe('recordAttempt', () => {
    test('should record successful attempt', async () => {
      const taskId = 'task-123';
      const userId = 'user-123';
      const attemptData = {
        is_successful: true,
        time_taken_seconds: 120,
        difficulty_multiplier: 1.0
      };

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('SELECT * FROM tasks')) {
          return Promise.resolve({ rows: [{ id: taskId, status: 'active' }] });
        }
        if (queryText.includes('SELECT id FROM task_attempts')) {
          return Promise.resolve({ rows: [] }); // No existing attempt
        }
        return Promise.resolve({ rows: [{ id: 'attempt-123' }] });
      });

      const result = await taskService.recordAttempt(taskId, userId, attemptData);

      expect(result).toHaveProperty('id');
      expect(result.is_successful).toBe(true);
      expect(result.time_taken_seconds).toBe(120);
    });

    test('should reject duplicate attempt', async () => {
      const taskId = 'task-123';
      const userId = 'user-123';
      const attemptData = {
        is_successful: true,
        time_taken_seconds: 120
      };

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('SELECT * FROM tasks')) {
          return Promise.resolve({ rows: [{ id: taskId, status: 'active' }] });
        }
        if (queryText.includes('SELECT id FROM task_attempts')) {
          return Promise.resolve({ rows: [{ id: 'existing-attempt' }] }); // Existing attempt
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(taskService.recordAttempt(taskId, userId, attemptData))
        .rejects.toThrow(ConflictError);
    });

    test('should reject attempt for expired task', async () => {
      const taskId = 'task-123';
      const userId = 'user-123';
      const attemptData = {
        is_successful: true,
        time_taken_seconds: 120
      };

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('SELECT * FROM tasks')) {
          return Promise.resolve({ 
            rows: [{ 
              id: taskId, 
              status: 'active',
              expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired yesterday
            }] 
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(taskService.recordAttempt(taskId, userId, attemptData))
        .rejects.toThrow('Task has expired');
    });
  });

  describe('publishTask', () => {
    test('should publish valid task', async () => {
      const taskId = 'task-123';
      const companyId = 'company-123';

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('SELECT * FROM tasks')) {
          return Promise.resolve({ 
            rows: [{ 
              id: taskId,
              company_id: companyId,
              status: 'draft',
              image_url: 'https://example.com/image.jpg',
              reward_value: 10.99
            }] 
          });
        }
        return Promise.resolve({ rows: [{ id: taskId, status: 'active' }] });
      });

      const result = await taskService.publishTask(taskId, companyId);

      expect(result.status).toBe('active');
    });

    test('should reject publishing active task', async () => {
      const taskId = 'task-123';
      const companyId = 'company-123';

      const { query } = require('../../src/database/connection');
      query.mockResolvedValue({ 
        rows: [{ 
          id: taskId,
          company_id: companyId,
          status: 'active' // Already active
        }] 
      });

      await expect(taskService.publishTask(taskId, companyId))
        .rejects.toThrow(ForbiddenError);
    });

    test('should reject publishing task without image', async () => {
      const taskId = 'task-123';
      const companyId = 'company-123';

      const { query } = require('../../src/database/connection');
      query.mockResolvedValue({ 
        rows: [{ 
          id: taskId,
          company_id: companyId,
          status: 'draft',
          image_url: null, // No image
          reward_value: 10.99
        }] 
      });

      await expect(taskService.publishTask(taskId, companyId))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('featureTask', () => {
    test('should feature task for valid duration', async () => {
      const taskId = 'task-123';
      const companyId = 'company-123';
      const durationDays = 7;

      const { query } = require('../../src/database/connection');
      query.mockImplementation((queryText, params) => {
        if (queryText.includes('SELECT * FROM tasks')) {
          return Promise.resolve({ 
            rows: [{ 
              id: taskId,
              company_id: companyId,
              status: 'active'
            }] 
          });
        }
        return Promise.resolve({ rows: [{ id: taskId, is_featured: true }] });
      });

      const result = await taskService.featureTask(taskId, companyId, durationDays);

      expect(result).toHaveProperty('task');
      expect(result).toHaveProperty('cost');
      expect(result).toHaveProperty('featured_until');
      expect(result.cost).toBe(7 * 99); // 7 days * 99 per day
    });

    test('should reject featuring non-active task', async () => {
      const taskId = 'task-123';
      const companyId = 'company-123';
      const durationDays = 7;

      const { query } = require('../../src/database/connection');
      query.mockResolvedValue({ 
        rows: [{ 
          id: taskId,
          company_id: companyId,
          status: 'draft' // Not active
        }] 
      });

      await expect(taskService.featureTask(taskId, companyId, durationDays))
        .rejects.toThrow(ForbiddenError);
    });
  });
});
