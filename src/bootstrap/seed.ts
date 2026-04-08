import { INestApplication, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../modules/database/entities/user.entity';
import * as bcrypt from 'bcrypt';

const logger = new Logger('SeedData');

/**
 * Seed initial data into database
 * Called during application bootstrap
 */
export async function seedData(app: INestApplication) {
  logger.log('Seeding initial data...');

  try {
    const dataSource = app.get(DataSource);

    // Wait for database connection
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // Seed users
    await seedUsers(dataSource);

    logger.log('✅ Seed data complete');
  } catch (error) {
    logger.error(`Failed to seed data: ${error.message}`);
    throw error;
  }
}

/**
 * Seed default users
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
    // Check if user already exists
    const existing = await userRepository.findOne({
      where: { username: userData.username },
    });

    if (!existing) {
      const user = new User();
      user.username = userData.username;

      // Hash password
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
