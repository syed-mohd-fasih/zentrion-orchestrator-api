/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Events service for internal event handling
 * Can be extended with Kafka/NATS for distributed systems
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  // In-memory event emitter
  private emitter = new EventEmitter2();

  /**
   * Emit an event
   */
  emit(event: string, payload: any) {
    this.logger.debug(`Event emitted: ${event}`);
    this.emitter.emit(event, payload);
  }

  /**
   * Subscribe to an event
   */
  on(event: string, callback: (payload: any) => void) {
    this.emitter.on(event, callback);
  }

  /**
   * Subscribe to an event once
   */
  once(event: string, callback: (payload: any) => void) {
    this.emitter.once(event, callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: (payload: any) => void) {
    this.emitter.off(event, callback);
  }
}
