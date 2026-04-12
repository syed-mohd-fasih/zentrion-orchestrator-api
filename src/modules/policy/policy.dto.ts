import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
} from 'class-validator';
import { AuthorizationRule } from '../../common/types';

export class CreatePolicyDraftDto {
  @IsString()
  @IsNotEmpty()
  service: string;

  @IsString()
  @IsNotEmpty()
  namespace: string;

  @IsArray()
  rules: AuthorizationRule[];

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  anomalyId?: string;
}

export class ApprovePolicyDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectPolicyDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class GeneratePolicyFromAnomalyDto {
  @IsString()
  @IsNotEmpty()
  anomalyId: string;
}
