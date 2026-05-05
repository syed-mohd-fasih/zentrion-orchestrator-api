import { Controller, Get, Optional } from '@nestjs/common';
import { LlmService } from './modules/policy/llm.service';
import { AiDetectionService } from './modules/anomaly/ai-detection.service';
import { SettingsService } from './modules/settings/settings.service';

@Controller('health')
export class HealthController {
  constructor(
    @Optional() private llmService: LlmService,
    @Optional() private aiDetectionService: AiDetectionService,
    @Optional() private settingsService: SettingsService,
  ) {}

  @Get()
  async check() {
    const [ollamaOk, mlOk] = await Promise.all([
      this.llmService?.isAvailable().catch(() => false) ?? Promise.resolve(false),
      this.aiDetectionService?.isAvailable().catch(() => false) ?? Promise.resolve(false),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'orchestrator-api',
      version: '1.0.0',
      ai: {
        detectionMode: this.settingsService?.getDetectionMode() ?? 'rules',
        ollama: ollamaOk,
        mlService: mlOk,
        model: this.settingsService?.getLlmModel() ?? 'unknown',
      },
    };
  }
}
