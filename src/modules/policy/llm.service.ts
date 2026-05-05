import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';

export interface LlmPolicyResponse {
  explanation: string;
  severityReasoning: string;
  policyYaml: string;
  policyReasoning: string;
  estimatedImpact: string;
  alternatives: string[];
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
      const parsed = JSON.parse(raw) as { response: string };
      return this.parseResponse(parsed.response);
    } catch (err) {
      this.logger.warn(`LLM generate failed: ${(err as Error).message}`);
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.httpGet('/api/tags', 2_000);
      return true;
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
