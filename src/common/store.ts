/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ParsedRequest,
  ServiceInfo,
  Anomaly,
  PolicyDraft,
  PolicyHistory,
  User,
  AppliedManifest,
} from './types';

/**
 * In-memory store for all application data
 * Can be swapped with Redis/DB later by implementing same interface
 */
class InMemoryStore {
  // Telemetry
  private logs: Map<string, ParsedRequest> = new Map();
  private services: Map<string, ServiceInfo> = new Map();

  // Anomalies
  private anomalies: Map<string, Anomaly> = new Map();

  // Policies
  private policyDrafts: Map<string, PolicyDraft> = new Map();
  private policyHistory: PolicyHistory[] = [];
  private appliedManifests: Map<string, AppliedManifest> = new Map();

  // Auth
  private users: Map<string, User> = new Map();
  private sessions: Map<string, string> = new Map(); // token -> userId

  // Telemetry Methods
  addLog(log: ParsedRequest) {
    this.logs.set(log.id, log);
    // Keep only last 1000 logs
    if (this.logs.size > 1000) {
      const firstKey = this.logs.keys().next().value;
      this.logs.delete(firstKey);
    }
  }

  getLogs(limit = 100, service?: string): ParsedRequest[] {
    let logs = Array.from(this.logs.values());
    if (service) {
      logs = logs.filter((l) => l.service === service);
    }
    return logs.slice(-limit).reverse();
  }

  getLog(id: string): ParsedRequest | undefined {
    return this.logs.get(id);
  }

  // Services
  setService(service: ServiceInfo) {
    this.services.set(service.name, service);
  }

  getService(name: string): ServiceInfo | undefined {
    return this.services.get(name);
  }

  getAllServices(): ServiceInfo[] {
    return Array.from(this.services.values());
  }

  updateServiceMetrics(name: string, metrics: Partial<ServiceInfo>) {
    const service = this.services.get(name);
    if (service) {
      this.services.set(name, { ...service, ...metrics });
    }
  }

  // Anomalies
  addAnomaly(anomaly: Anomaly) {
    this.anomalies.set(anomaly.id, anomaly);
  }

  getAnomaly(id: string): Anomaly | undefined {
    return this.anomalies.get(id);
  }

  getAllAnomalies(limit?: number): Anomaly[] {
    const all = Array.from(this.anomalies.values()).sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return limit ? all.slice(0, limit) : all;
  }

  getAnomaliesByService(service: string): Anomaly[] {
    return Array.from(this.anomalies.values()).filter(
      (a) => a.service === service,
    );
  }

  // Policy Drafts
  addPolicyDraft(draft: PolicyDraft) {
    this.policyDrafts.set(draft.id, draft);
  }

  getPolicyDraft(id: string): PolicyDraft | undefined {
    return this.policyDrafts.get(id);
  }

  getAllPolicyDrafts(): PolicyDraft[] {
    return Array.from(this.policyDrafts.values());
  }

  getPendingDrafts(): PolicyDraft[] {
    return Array.from(this.policyDrafts.values()).filter(
      (d) => d.status === 'pending',
    );
  }

  getActivePolicies(): PolicyDraft[] {
    return Array.from(this.policyDrafts.values()).filter(
      (d) => d.status === 'applied',
    );
  }

  updatePolicyDraft(id: string, updates: Partial<PolicyDraft>) {
    const draft = this.policyDrafts.get(id);
    if (draft) {
      this.policyDrafts.set(id, { ...draft, ...updates });
    }
  }

  // Policy History
  addPolicyHistory(history: PolicyHistory) {
    this.policyHistory.push(history);
  }

  getPolicyHistory(policyId?: string): PolicyHistory[] {
    if (policyId) {
      return this.policyHistory.filter((h) => h.policyId === policyId);
    }
    return [...this.policyHistory].reverse();
  }

  // Applied Manifests
  addAppliedManifest(manifest: AppliedManifest) {
    this.appliedManifests.set(manifest.id, manifest);
  }

  getAppliedManifest(id: string): AppliedManifest | undefined {
    return this.appliedManifests.get(id);
  }

  getAllAppliedManifests(): AppliedManifest[] {
    return Array.from(this.appliedManifests.values()).filter(
      (m) => m.status === 'active',
    );
  }

  // Users
  addUser(user: User) {
    this.users.set(user.id, user);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByUsername(username: string): User | undefined {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  // Sessions
  addSession(token: string, userId: string) {
    this.sessions.set(token, userId);
  }

  getSession(token: string): string | undefined {
    return this.sessions.get(token);
  }

  removeSession(token: string) {
    this.sessions.delete(token);
  }

  // Utility
  clear() {
    this.logs.clear();
    this.services.clear();
    this.anomalies.clear();
    this.policyDrafts.clear();
    this.policyHistory = [];
    this.appliedManifests.clear();
    this.users.clear();
    this.sessions.clear();
  }

  getStats() {
    return {
      logs: this.logs.size,
      services: this.services.size,
      anomalies: this.anomalies.size,
      policyDrafts: this.policyDrafts.size,
      policyHistory: this.policyHistory.length,
      appliedManifests: this.appliedManifests.size,
      users: this.users.size,
      sessions: this.sessions.size,
    };
  }
}

// Singleton instance
export const store = new InMemoryStore();
