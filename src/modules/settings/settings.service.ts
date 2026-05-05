import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../database/entities/system-setting.entity';

const DEFAULTS: Array<{ key: string; value: string }> = [
  { key: 'detectionMode', value: 'rules' },
  { key: 'aiConfidenceThreshold', value: '0.7' },
  { key: 'llmModel', value: 'qwen2.5:7b' },
  { key: 'sandboxWindowHours', value: '24' },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepo: Repository<SystemSetting>,
  ) {}

  async onModuleInit() {
    // Seed defaults — upsert so existing values are never overwritten.
    await this.settingRepo.upsert(DEFAULTS, ['key']);
    const all = await this.settingRepo.find();
    for (const s of all) {
      this.cache.set(s.key, s.value);
    }
    this.logger.log('Settings loaded from database');
  }

  getDetectionMode(): 'rules' | 'ai' {
    const v = this.cache.get('detectionMode');
    return v === 'ai' ? 'ai' : 'rules';
  }

  getAiConfidenceThreshold(): number {
    return parseFloat(this.cache.get('aiConfidenceThreshold') ?? '0.7');
  }

  getLlmModel(): string {
    return this.cache.get('llmModel') ?? 'qwen2.5:7b';
  }

  getSandboxWindowHours(): number {
    return parseInt(this.cache.get('sandboxWindowHours') ?? '24', 10);
  }

  async getAll(): Promise<SystemSetting[]> {
    return this.settingRepo.find({ order: { key: 'ASC' } });
  }

  async update(key: string, value: string): Promise<SystemSetting> {
    await this.settingRepo.upsert([{ key, value }], ['key']);
    this.cache.set(key, value);
    return this.settingRepo.findOne({ where: { key } }) as Promise<SystemSetting>;
  }
}
