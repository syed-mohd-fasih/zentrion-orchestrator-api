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

/**
 * WebSocket gateway for real-time dashboard updates.
 *
 * Owns the single Socket.IO server that pushes:
 *  - `telemetry.log`    — each Envoy log as it's persisted.
 *  - `service.update`   — per-service metric refreshes.
 *  - `anomaly.created`  — newly detected anomalies.
 *  - `policy.draft`     — newly generated policy drafts.
 *  - `policy.applied`   — after an approved policy lands in the cluster.
 *
 * To keep layering clean, `TelemetryService` doesn't depend on Socket.IO —
 * instead this gateway registers an emitter callback on `afterInit` that
 * the service invokes. Other modules bypass that callback and push through
 * the `emit*` helpers directly.
 */
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

  /**
   * Called once the Socket.IO server is up. Registers a thin callback on
   * `TelemetryService` so the service can publish events without importing
   * Socket.IO types.
   */
  afterInit() {
    this.logger.log('WebSocket Gateway initialized');

    this.telemetryService.setEventEmitter((event: string, data: any) => {
      this.server.emit(event, data);
    });
  }

  /** Log every new client connection (id is assigned by Socket.IO). */
  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  /** Log every disconnect — useful when chasing missing UI updates. */
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Broadcast a single telemetry log line to every connected client. */
  emitLog(log: any) {
    this.server.emit('telemetry.log', log);
  }

  /** Broadcast a per-service metric refresh. */
  emitServiceUpdate(service: any) {
    this.server.emit('service.update', service);
  }

  /** Broadcast a newly detected anomaly. */
  emitAnomaly(anomaly: any) {
    this.server.emit('anomaly.created', anomaly);
  }

  /** Broadcast a newly generated policy draft. */
  emitPolicyDraft(draft: any) {
    this.server.emit('policy.draft', draft);
  }

  /** Broadcast the "policy successfully applied to cluster" event. */
  emitPolicyApplied(policy: any) {
    this.server.emit('policy.applied', policy);
  }
}
