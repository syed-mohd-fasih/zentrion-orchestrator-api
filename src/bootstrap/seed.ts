import { INestApplication, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../modules/database/entities/user.entity';
import * as bcrypt from 'bcrypt';

const logger = new Logger('SeedData');

/**
 * Seed initial data into the database.
 *
 * Called once during application bootstrap (see `main.ts`). Ensures the
 * default admin/analyst/viewer accounts exist so the dashboard has something
 * to log in with on a fresh deployment. Safe to run repeatedly — each seeding
 * step checks for existing records before inserting.
 *
 * @param app Initialized Nest application (provides access to the TypeORM `DataSource`).
 * @throws Re-throws any error encountered so bootstrap fails loudly instead of silently.
 */
export async function seedData(app: INestApplication) {
  logger.log('Seeding initial data...');

  try {
    const dataSource = app.get(DataSource);

    // Defensive: TypeORM should already be initialized by NestJS, but if the
    // data source is somehow uninitialized, bring it up before seeding.
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await seedUsers(dataSource);

    logger.log('✅ Seed data complete');
  } catch (error) {
    logger.error(`Failed to seed data: ${error.message}`);
    throw error;
  }
}

/**
 * Seed the three default user accounts.
 *
 * Inserts `admin`, `analyst`, and `viewer` users with bcrypt-hashed passwords
 * if they do not already exist. The plaintext defaults are intentional
 * demo/FYP credentials and MUST be rotated before any real deployment.
 *
 * @param dataSource Initialized TypeORM `DataSource`.
 */
async function seedUsers(dataSource: DataSource) {
  const userRepository = dataSource.getRepository(User);

  const users = [
    {
      username: 'admin',
      password: 'admin123',
      role: 'ADMIN',
      email: 'admin@zentrion.io',
    },
    {
      username: 'analyst',
      password: 'analyst123',
      role: 'ANALYST',
      email: 'analyst@zentrion.io',
    },
    {
      username: 'viewer',
      password: 'viewer123',
      role: 'VIEWER',
      email: 'viewer@zentrion.io',
    },
  ];

  for (const userData of users) {
    const existing = await userRepository.findOne({
      where: { username: userData.username },
    });

    if (!existing) {
      const user = new User();
      user.username = userData.username;

      // Hash with a cost factor of 10 (bcrypt default trade-off between
      // security and seed-time performance on modest hardware).
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(userData.password, salt);

      user.role = userData.role;
      user.email = userData.email;

      await userRepository.save(user);

      logger.log(`👤 User created: ${userData.username} (${userData.role})`);
    } else {
      logger.log(`👤 User already exists: ${userData.username}`);
    }
  }
}
