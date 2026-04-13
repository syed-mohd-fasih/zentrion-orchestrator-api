import { Injectable } from '@nestjs/common';

/**
 * Root application service.
 *
 * Backs the default `GET /` route. Kept intentionally minimal — real business
 * logic lives in feature modules under `src/modules/*`.
 */
@Injectable()
export class AppService {
  /**
   * Returns the canonical greeting string used by the root route.
   *
   * @returns The literal string "Hello World!".
   */
  getHello(): string {
    return 'Hello World!';
  }
}
