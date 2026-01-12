const fs = require('fs').promises;
const path = require('path');
const { connectDatabase, query } = require('./connection');
const logger = require('../utils/logger');

class MigrationManager {
  constructor() {
    this.migrationsPath = path.join(__dirname, 'migrations');
    this.migrationsTable = 'schema_migrations';
  }

  /**
   * Initialize migrations table
   */
  async initMigrationsTable() {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logger.info('Migrations table initialized');
    } catch (error) {
      logger.error('Failed to initialize migrations table:', error);
      throw error;
    }
  }

  /**
   * Get list of migration files
   */
  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      return files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort to ensure proper order
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('Migrations directory not found, creating it');
        await fs.mkdir(this.migrationsPath, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  /**
   * Get executed migrations from database
   */
  async getExecutedMigrations() {
    try {
      const result = await query(`SELECT filename FROM ${this.migrationsTable}`);
      return new Set(result.rows.map(row => row.filename));
    } catch (error) {
      logger.error('Failed to get executed migrations:', error);
      throw error;
    }
  }

  /**
   * Execute a migration file
   */
  async executeMigration(filename) {
    try {
      const filePath = path.join(this.migrationsPath, filename);
      const migrationSQL = await fs.readFile(filePath, 'utf8');

      logger.info(`Executing migration: ${filename}`);

      // Start transaction
      await query('BEGIN');

      try {
        // Execute migration SQL
        await query(migrationSQL);

        // Record migration as executed
        await query(
          `INSERT INTO ${this.migrationsTable} (filename) VALUES ($1)`,
          [filename]
        );

        // Commit transaction
        await query('COMMIT');

        logger.info(`Migration executed successfully: ${filename}`);
      } catch (error) {
        // Rollback on error
        await query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      logger.error(`Failed to execute migration ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate() {
    try {
      logger.info('Starting database migration...');

      // Initialize migrations table
      await this.initMigrationsTable();

      // Get migration files and executed migrations
      const migrationFiles = await this.getMigrationFiles();
      const executedMigrations = await getExecutedMigrations();

      // Filter pending migrations
      const pendingMigrations = migrationFiles.filter(
        file => !executedMigrations.has(file)
      );

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations found');
        return;
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`);

      // Execute pending migrations
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
      }

      logger.info('All migrations executed successfully');

    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Create a new migration file
   */
  async createMigration(name) {
    try {
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
      const filename = `${timestamp}_${name}.sql`;
      const filePath = path.join(this.migrationsPath, filename);

      const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add your migration SQL here
-- Example:
-- ALTER TABLE users ADD COLUMN new_field VARCHAR(100);

-- Remember to:
-- 1. Use IF NOT EXISTS for new tables
-- 2. Handle potential conflicts gracefully
-- 3. Add appropriate indexes
-- 4. Update any necessary views or triggers
`;

      await fs.writeFile(filePath, template);
      logger.info(`Migration file created: ${filename}`);

      return filename;

    } catch (error) {
      logger.error('Failed to create migration file:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async status() {
    try {
      await this.initMigrationsTable();

      const migrationFiles = await this.getMigrationFiles();
      const executedMigrations = await getExecutedMigrations();

      const status = migrationFiles.map(file => ({
        filename: file,
        status: executedMigrations.has(file) ? 'executed' : 'pending'
      }));

      return {
        total: migrationFiles.length,
        executed: executedMigrations.size,
        pending: migrationFiles.length - executedMigrations.size,
        migrations: status
      };

    } catch (error) {
      logger.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Rollback last migration (if rollback file exists)
   */
  async rollback(steps = 1) {
    try {
      logger.info(`Rolling back last ${steps} migration(s)...`);

      const executedMigrations = await query(
        `SELECT filename FROM ${this.migrationsTable} ORDER BY executed_at DESC LIMIT $1`,
        [steps]
      );

      if (executedMigrations.rows.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }

      for (const row of executedMigrations.rows) {
        const filename = row.filename;
        const rollbackFilename = filename.replace('.sql', '_rollback.sql');
        const rollbackFilePath = path.join(this.migrationsPath, rollbackFilename);

        try {
          const rollbackSQL = await fs.readFile(rollbackFilePath, 'utf8');

          logger.info(`Executing rollback: ${rollbackFilename}`);

          await query('BEGIN');
          try {
            await query(rollbackSQL);
            await query(`DELETE FROM ${this.migrationsTable} WHERE filename = $1`, [filename]);
            await query('COMMIT');
            logger.info(`Rollback executed successfully: ${rollbackFilename}`);
          } catch (error) {
            await query('ROLLBACK');
            throw error;
          }

        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.warn(`No rollback file found for ${filename}`);
          } else {
            throw error;
          }
        }
      }

      logger.info('Rollback completed successfully');

    } catch (error) {
      logger.error('Rollback failed:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    // Connect to database
    await connectDatabase();

    const migrationManager = new MigrationManager();

    switch (command) {
      case 'migrate':
        await migrationManager.migrate();
        break;

      case 'create':
        if (args.length === 0) {
          console.error('Migration name is required');
          process.exit(1);
        }
        await migrationManager.createMigration(args[0]);
        break;

      case 'status':
        const status = await migrationManager.status();
        console.log('Migration Status:');
        console.log(`Total: ${status.total}`);
        console.log(`Executed: ${status.executed}`);
        console.log(`Pending: ${status.pending}`);
        console.log('\nMigrations:');
        status.migrations.forEach(m => {
          console.log(`  ${m.status === 'executed' ? '✓' : '○'} ${m.filename}`);
        });
        break;

      case 'rollback':
        const steps = parseInt(args[0]) || 1;
        await migrationManager.rollback(steps);
        break;

      default:
        console.log('Usage:');
        console.log('  node migrate.js migrate                    # Run all pending migrations');
        console.log('  node migrate.js create <name>              # Create new migration file');
        console.log('  node migrate.js status                     # Show migration status');
        console.log('  node migrate.js rollback [steps]           # Rollback last migration(s)');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    logger.error('Migration command failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = MigrationManager;

// Run CLI if called directly
if (require.main === module) {
  main();
}
