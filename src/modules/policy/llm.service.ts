import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import { ChatMessage } from '../../common/types';

export interface LlmPolicyResponse {
  explanation: string;
  severityReasoning: string;
  policyYaml: string;
  policyReasoning: string;
  estimatedImpact: string;
  alternatives: string[];
}

export interface ComplianceMetrics {
  activePolicies: number;
  unresolvedAnomalies: number;
  anomaliesLast7d: number;
  policiesApplied7d: number;
}

export interface ComplianceScore {
  score: number;
  summary: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.host = this.configService.get<string>('ai.ollamaHost', 'ollama.zentrion-system.svc.cluster.local');
    this.port = this.configService.get<number>('ai.ollamaPort', 11434);
    this.model = this.configService.get<string>('ai.ollamaModel', 'qwen2.5:7b');
  }

  async generate(prompt: string): Promise<LlmPolicyResponse | null> {
    const body = JSON.stringify({
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 1024 },
    });

    try {
      const raw = await this.httpPost('/api/generate', body, 120_000);
      const parsed = JSON.parse(raw) as { response?: string; error?: string };
      if (parsed.error || !parsed.response) {
        this.logger.warn(
          `Ollama returned no response (model="${this.model}"): ${parsed.error ?? 'empty response — is the model pulled?'}`,
        );
        return null;
      }
      return this.parseResponse(parsed.response);
    } catch (err) {
      this.logger.warn(`LLM generate failed: ${(err as Error).message}`);
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const raw = await this.httpGet('/api/tags', 2_000);
      const parsed = JSON.parse(raw) as { models?: Array<{ name: string }> };
      return Array.isArray(parsed.models) && parsed.models.length > 0;
    } catch {
      return false;
    }
  }

  private parseResponse(raw: string): LlmPolicyResponse | null {
    try {
      // Strip markdown code fences if the model wrapped its response.
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const result = JSON.parse(cleaned) as LlmPolicyResponse;
      // Ensure alternatives is always an array.
      if (!Array.isArray(result.alternatives)) {
        result.alternatives = result.alternatives
          ? [String(result.alternatives)]
          : [];
      }
      return result;
    } catch (err) {
      this.logger.warn(`LLM response parse error: ${(err as Error).message}`);
      return null;
    }
  }

  private httpPost(path: string, body: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`LLM request timed out after ${timeoutMs}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private httpGet(path: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: this.host, port: this.port, path, method: 'GET' },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request timed out`));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async generateComplianceScore(metrics: ComplianceMetrics): Promise<ComplianceScore | null> {
    const prompt = `You are a security compliance analyst for a Kubernetes service mesh.
Given these current security metrics:
- Active AuthorizationPolicies applied: ${metrics.activePolicies}
- Unresolved anomalies: ${metrics.unresolvedAnomalies}
- Anomalies detected in the last 7 days: ${metrics.anomaliesLast7d}
- New policies applied in the last 7 days: ${metrics.policiesApplied7d}

Rate the overall policy compliance posture on a scale of 0 to 100, where 100 means fully secured with no unresolved threats and active policies in place, and 0 means no policies and many unresolved anomalies.

Return ONLY a JSON object with no markdown, no explanation outside it:
{"score": <integer 0-100>, "summary": "<one sentence describing the compliance posture>"}`;

    const body = JSON.stringify({
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 128 },
    });

    try {
      const raw = await this.httpPost('/api/generate', body, 30_000);
      const parsed = JSON.parse(raw) as { response?: string; error?: string };
      if (parsed.error || !parsed.response) {
        this.logger.warn(
          `Ollama returned no response (model="${this.model}"): ${parsed.error ?? 'empty response — is the model pulled?'}`,
        );
        return null;
      }
      const cleaned = parsed.response
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const result = JSON.parse(cleaned) as ComplianceScore;
      if (typeof result.score !== 'number' || typeof result.summary !== 'string') return null;
      result.score = Math.max(0, Math.min(100, Math.round(result.score)));
      return result;
    } catch (err) {
      this.logger.warn(`Compliance score generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  buildChatSystemPrompt(anomalyType: string, anomalyDetails: string, yamlContent: string): string {
    return `You are a Kubernetes/Istio security expert helping a security analyst evaluate this Istio AuthorizationPolicy draft.

Draft YAML:
${yamlContent}

Source anomaly: ${anomalyType} — ${anomalyDetails}

Answer the analyst's questions about this specific draft. Keep replies concise (max ~150 words) and in plain language. Stay on-topic to this policy and its anomaly context. Only quote YAML fragments when the question is about a specific field.`;
  }

  chatStream(
    systemPrompt: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ): { abort: () => void } {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
      options: { temperature: 0.2, num_predict: 512 },
    });

    const req = http.request(
      {
        host: this.host,
        port: this.port,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', (c: Buffer) => (errBody += c.toString('utf8')));
          res.on('end', () => {
            this.logger.warn(`Ollama /api/chat returned ${res.statusCode}: ${errBody.slice(0, 300)}`);
            onError(new Error(`Ollama returned HTTP ${res.statusCode}`));
          });
          return;
        }

        let buf = '';
        let done = false;
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as {
                message?: { role: string; content: string };
                done?: boolean;
                error?: string;
              };
              if (parsed.error) {
                onError(new Error(parsed.error));
                done = true;
                req.destroy();
                return;
              }
              const token = parsed.message?.content;
              if (token) onToken(token);
              if (parsed.done) {
                done = true;
                onDone();
                return;
              }
            } catch (err) {
              this.logger.warn(`chatStream line parse failed: ${(err as Error).message} — line: ${line.slice(0, 200)}`);
            }
          }
        });
        res.on('end', () => {
          if (!done) onDone();
        });
        res.on('error', (err) => onError(err));
      },
    );

    req.setTimeout(120_000, () => req.destroy(new Error('Ollama chat timed out after 120s')));
    req.on('error', (err) => onError(err));
    req.write(body);
    req.end();

    return { abort: () => req.destroy() };
  }

  buildAnomalyPrompt(anomalyType: string, anomalyDetails: string, yamlContent: string): string {
    return `You are a Kubernetes/Istio security expert analyzing an anomaly and evaluating a proposed security policy.

Anomaly Type: ${anomalyType}
Anomaly Details: ${anomalyDetails}
Proposed Istio AuthorizationPolicy YAML:
${yamlContent}

Return ONLY a JSON object with these exact keys. No markdown. No text outside the JSON.
"alternatives" MUST be a JSON array of strings: ["option 1", "option 2"]
"policyYaml" MUST use \\n for newlines (compact single-line string).

{
  "explanation": "Plain-language explanation of what this anomaly means and why this policy addresses it",
  "severityReasoning": "Why this anomaly has the severity it does and what the risk is",
  "policyYaml": "the yaml content as a compact single-line string with \\n for newlines",
  "policyReasoning": "Why this specific Istio AuthorizationPolicy rule structure was chosen",
  "estimatedImpact": "What legitimate traffic, if any, this policy might affect",
  "alternatives": ["alternative approach 1", "alternative approach 2"]
}`;
  }
}
