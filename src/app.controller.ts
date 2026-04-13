import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * Root controller.
 *
 * Exposes a trivial `GET /` endpoint used as a liveness smoke-test separate
 * from the dedicated `/health` route.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Returns a static greeting string.
   *
   * @returns Plain-text greeting ("Hello World!").
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
