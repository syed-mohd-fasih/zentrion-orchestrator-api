import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
} from 'class-validator';
import { AuthorizationRule } from '../../common/types';

/**
 * Body for `POST /policies/drafts` — manually create a draft.
 */
export class CreatePolicyDraftDto {
  /** Target service name (`app=<service>` label selector). */
  @IsString()
  @IsNotEmpty()
  service: string;

  /** Namespace the policy applies to. */
  @IsString()
  @IsNotEmpty()
  namespace: string;

  /** Authorization rules to compile into the generated YAML. */
  @IsArray()
  rules: AuthorizationRule[];

  /** Human-readable justification recorded on the draft + in history. */
  @IsString()
  @IsNotEmpty()
  reason: string;

  /** Optional anomaly id this manual draft was motivated by. */
  @IsString()
  @IsOptional()
  anomalyId?: string;
}

/**
 * Body for `POST /policies/drafts/:id/approve`.
 *
 * Currently only carries optional free-form notes (not yet persisted, but
 * reserved for future audit-trail enrichment).
 */
export class ApprovePolicyDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Body for `POST /policies/drafts/:id/reject` — reason is required so
 * analysts always justify rejections.
 */
export class RejectPolicyDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

/**
 * Body for `POST /policies/drafts/from-anomaly` — references the anomaly
 * by its public `anomalyId` UUID.
 */
export class GeneratePolicyFromAnomalyDto {
  @IsString()
  @IsNotEmpty()
  anomalyId: string;
}
