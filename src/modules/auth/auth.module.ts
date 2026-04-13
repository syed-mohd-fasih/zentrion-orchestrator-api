import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { User } from '../database/entities/user.entity';

/**
 * Authentication module.
 *
 * Wires up JWT-based auth for the whole application:
 *  - registers the `User` repository so `AuthService` / `JwtStrategy` can
 *    look users up;
 *  - installs Passport with the `jwt` strategy as the default;
 *  - configures `JwtModule` with secret + expiry from `ConfigService`.
 *
 * Re-exports the providers other modules need (`AuthService` for imperative
 * checks, `JwtStrategy`/`PassportModule` for guards on other controllers).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.secret'),
        signOptions: {
          expiresIn: config.get('jwt.expiresIn'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
