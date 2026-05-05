import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as yaml from 'js-yaml';
import { PolicyDraft } from '../database/entities/policy-draft.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';

export interface SandboxResult {
  totalLogsEvaluated: number;
  wouldBlock: Array<{
    id: string;
    sourceIp: string;
    path: string;
    service: string;
    method: string;
  }>;
  wouldAllow: number;
  effectivenessScore: number;
  falsePositiveRisk: number;
  anomalyLogsBlocked: number;
}

function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split('/');
    const mask = bits ? ~((1 << (32 - parseInt(bits, 10))) - 1) : -1;
    const toInt = (addr: string) =>
      addr.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0);
    return (toInt(ip) & mask) === (toInt(range) & mask);
  } catch {
    return false;
  }
}

function matchesPath(logPath: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return logPath.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*')) return logPath.endsWith(pattern.slice(1));
  return logPath === pattern;
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    @InjectRepository(PolicyDraft)
    private draftRepo: Repository<PolicyDraft>,
    @InjectRepository(TelemetryLog)
    private logRepo: Repository<TelemetryLog>,
  ) {}

  async simulateDraft(draftId: string, windowHours: number, anomalyLogIds: string[] = []): Promise<SandboxResult> {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);

    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const logs = await this.logRepo.find({
      where: { timestamp: MoreThan(cutoff) },
      order: { timestamp: 'DESC' },
      take: 2000,
    });

    const policy = yaml.load(draft.yamlContent) as any;
    const spec = policy?.spec ?? {};
    const selectorLabels: Record<string, string> = spec.selector?.matchLabels ?? {};
    const rules: any[] = spec.rules ?? [];

    const wouldBlock: SandboxResult['wouldBlock'] = [];

    for (const log of logs) {
      // If the policy has a selector, only evaluate matching service logs.
      if (Object.keys(selectorLabels).length > 0) {
        const appLabel = selectorLabels['app'];
        if (appLabel && log.service !== appLabel) continue;
      }

      if (this.logMatchesDeny(log, rules)) {
        wouldBlock.push({
          id: log.id,
          sourceIp: log.sourceIp,
          path: log.path,
          service: log.service,
          method: log.method,
        });
      }
    }

    const totalLogsEvaluated = logs.length;
    const wouldAllow = totalLogsEvaluated - wouldBlock.length;
    const effectivenessScore = totalLogsEvaluated > 0
      ? Math.min(100, Math.round((wouldBlock.length / totalLogsEvaluated) * 100))
      : 0;

    const anomalySetIds = new Set(anomalyLogIds);
    const anomalyLogsBlocked = wouldBlock.filter((b) => anomalySetIds.has(b.id)).length;

    // False positive risk: proportion of blocked logs that are NOT anomaly-associated.
    const nonAnomalyBlocked = wouldBlock.length - anomalyLogsBlocked;
    const falsePositiveRisk = wouldBlock.length > 0
      ? Math.round((nonAnomalyBlocked / wouldBlock.length) * 100)
      : 0;

    const result: SandboxResult = {
      totalLogsEvaluated,
      wouldBlock,
      wouldAllow,
      effectivenessScore,
      falsePositiveRisk,
      anomalyLogsBlocked,
    };

    // Cache result on the draft row.
    draft.sandboxResult = result as unknown as Record<string, any>;
    await this.draftRepo.save(draft);

    return result;
  }

  private logMatchesDeny(log: TelemetryLog, rules: any[]): boolean {
    for (const rule of rules) {
      const fromMatches = this.evaluateFrom(log, rule.from ?? []);
      const toMatches = this.evaluateTo(log, rule.to ?? []);
      if (fromMatches && toMatches) return true;
    }
    return false;
  }

  private evaluateFrom(log: TelemetryLog, froms: any[]): boolean {
    if (froms.length === 0) return true;
    for (const fromClause of froms) {
      const source = fromClause.source ?? {};
      // ipBlocks check
      if (source.ipBlocks?.length) {
        const blocked = source.ipBlocks.some((cidr: string) =>
          cidr.includes('/') ? ipInCidr(log.sourceIp, cidr) : log.sourceIp === cidr,
        );
        if (blocked) return true;
      }
      // principals check
      if (source.principals?.length) {
        const matched = source.principals.some((p: string) => log.source === p || log.source?.includes(p));
        if (matched) return true;
      }
      // No from restrictions means always matches
      if (!source.ipBlocks?.length && !source.principals?.length) return true;
    }
    return false;
  }

  private evaluateTo(log: TelemetryLog, tos: any[]): boolean {
    if (tos.length === 0) return true;
    for (const toClause of tos) {
      const operation = toClause.operation ?? {};
      const methodMatch =
        !operation.methods?.length ||
        operation.methods.includes('*') ||
        operation.methods.includes(log.method);
      const pathMatch =
        !operation.paths?.length ||
        operation.paths.some((p: string) => matchesPath(log.path, p));
      if (methodMatch && pathMatch) return true;
    }
    return false;
  }
}
