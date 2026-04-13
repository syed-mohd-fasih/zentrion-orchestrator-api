/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import { AuthorizationRule } from '../../common/types';

/**
 * Build an Istio `AuthorizationPolicy` YAML manifest.
 *
 * Generates a `DENY`-action policy targeting `app=<serviceName>` with a
 * timestamped name (ensuring successive generations don't collide) and
 * Zentrion provenance annotations so operators can tell which policies
 * were auto-generated.
 *
 * @param serviceName Workload label (`app=<serviceName>`) the policy targets.
 * @param namespace   Namespace the policy is scoped to.
 * @param rules       Authorization rules (from/to/when) to compile into the manifest.
 * @param description Optional human-readable description (annotation only).
 * @returns YAML string ready to hand to `K8sService.applyManifest`.
 */
export function buildAuthorizationPolicy(
  serviceName: string,
  namespace: string,
  rules: AuthorizationRule[],
  description?: string,
): string {
  const manifest = {
    apiVersion: 'security.istio.io/v1beta1',
    kind: 'AuthorizationPolicy',
    metadata: {
      // Suffix with epoch-ms to avoid name collisions across generations.
      name: `${serviceName}-authz-${Date.now()}`,
      namespace,
      annotations: {
        description: description || `Authorization policy for ${serviceName}`,
        'zentrion.io/generated': 'true',
        'zentrion.io/generated-at': new Date().toISOString(),
      },
    },
    spec: {
      selector: {
        matchLabels: {
          app: serviceName,
        },
      },
      action: 'DENY',
      rules: rules.map((rule) => ({
        from: rule.from
          ? [
              {
                source: rule.from.source,
              },
            ]
          : undefined,
        to: rule.to
          ? [
              {
                operation: rule.to.operation,
              },
            ]
          : undefined,
        when: rule.when,
      })),
    },
  };

  return convertToYAML(manifest);
}

/**
 * Build an Istio `PeerAuthentication` YAML manifest.
 *
 * Controls mTLS enforcement for traffic reaching `app=<serviceName>`.
 *
 * @param serviceName Workload label (`app=<serviceName>`) the policy targets.
 * @param namespace   Namespace the policy is scoped to.
 * @param mtlsMode    mTLS enforcement mode. Defaults to `STRICT` (zero-trust).
 * @returns YAML string ready to hand to `K8sService.applyManifest`.
 */
export function buildPeerAuthentication(
  serviceName: string,
  namespace: string,
  mtlsMode: 'STRICT' | 'PERMISSIVE' | 'DISABLE' = 'STRICT',
): string {
  const manifest = {
    apiVersion: 'security.istio.io/v1beta1',
    kind: 'PeerAuthentication',
    metadata: {
      name: `${serviceName}-peer-auth`,
      namespace,
    },
    spec: {
      selector: {
        matchLabels: {
          app: serviceName,
        },
      },
      mtls: {
        mode: mtlsMode,
      },
    },
  };

  return convertToYAML(manifest);
}

/**
 * Decide whether a scalar value needs quoting in YAML output.
 *
 * YAML parsers coerce certain unquoted tokens (`true`, `yes`, numbers, ...)
 * to their typed value. When such a value is meant to stay a string — e.g.
 * an HTTP method name or a port as string — it must be quoted.
 *
 * @param value Raw string to inspect.
 * @returns `true` when the value must be double-quoted.
 */
function needsQuoting(value: string): boolean {
  const yamlBooleans = ['true', 'false', 'yes', 'no', 'on', 'off', 'null'];
  if (yamlBooleans.includes(value.toLowerCase())) return true;
  if (/^\d+(\.\d+)?$/.test(value)) return true;
  return false;
}

/**
 * Recursive object → YAML serializer.
 *
 * Intentionally minimal (no anchors, no flow style beyond empty arrays)
 * because the output only needs to be consumed by `kubectl apply` via the
 * `@kubernetes/client-node` client. For richer YAML needs, switch to
 * `js-yaml`'s `dump`.
 *
 * @param obj    Object to serialize.
 * @param indent Current indentation depth (2 spaces per level).
 * @returns YAML text.
 */
function convertToYAML(obj: any, indent = 0): string {
  const indentStr = '  '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
    // Drop keys with no value — keeps the manifest clean and avoids YAML `null`s.
    if (value === undefined || value === null) {
      continue;
    }

    yaml += `${indentStr}${key}:`;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        yaml += ' []\n';
      } else {
        yaml += '\n';
        value.forEach((item) => {
          if (typeof item === 'object') {
            yaml += `${indentStr}- `;
            const itemYaml = convertToYAML(item, indent + 1);
            // Drop the leading indent of the nested object so the `-` lines up.
            yaml += itemYaml.substring(indentStr.length + 2);
          } else if (typeof item === 'string' && needsQuoting(item)) {
            yaml += `${indentStr}- "${item}"\n`;
          } else {
            yaml += `${indentStr}- ${item}\n`;
          }
        });
      }
    } else if (typeof value === 'object') {
      yaml += '\n' + convertToYAML(value, indent + 1);
    } else if (typeof value === 'string' && needsQuoting(value)) {
      yaml += ` "${value}"\n`;
    } else {
      yaml += ` ${value}\n`;
    }
  }

  return yaml;
}
