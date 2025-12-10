/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import { AuthorizationRule } from '../../common/types';

/**
 * Build an Istio AuthorizationPolicy manifest
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

  // Convert to YAML format
  return convertToYAML(manifest);
}

/**
 * Build a PeerAuthentication manifest
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
 * Simple YAML converter (for demonstration)
 * In production, use a proper YAML library like js-yaml
 */
function convertToYAML(obj: any, indent = 0): string {
  const indentStr = '  '.repeat(indent);
  let yaml = '';

  for (const [key, value] of Object.entries(obj)) {
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
            yaml += itemYaml.substring(indentStr.length + 2);
          } else {
            yaml += `${indentStr}- ${item}\n`;
          }
        });
      }
    } else if (typeof value === 'object') {
      yaml += '\n' + convertToYAML(value, indent + 1);
    } else {
      yaml += ` ${value}\n`;
    }
  }

  return yaml;
}
