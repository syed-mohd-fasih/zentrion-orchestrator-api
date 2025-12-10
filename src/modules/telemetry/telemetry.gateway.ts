/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  },
})
export class TelemetryGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger(TelemetryGateway.name);

  constructor(private telemetryService: TelemetryService) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');

    // Register this gateway as event emitter for telemetry service
    this.telemetryService.setEventEmitter((event: string, data: any) => {
      this.server.emit(event, data);
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Manual emit helpers (can be called from other services)
  emitLog(log: any) {
    this.server.emit('telemetry.log', log);
  }

  emitServiceUpdate(service: any) {
    this.server.emit('service.update', service);
  }

  emitAnomaly(anomaly: any) {
    this.server.emit('anomaly.created', anomaly);
  }

  emitPolicyDraft(draft: any) {
    this.server.emit('policy.draft', draft);
  }

  emitPolicyApplied(policy: any) {
    this.server.emit('policy.applied', policy);
  }
}
