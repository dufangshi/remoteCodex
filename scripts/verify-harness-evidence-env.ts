import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

interface Requirement {
  group: 'admin' | 'staging' | 'invoke' | 'agent-ui' | 'k8s' | 'optional' | 'review';
  name: string;
  required: boolean;
  description: string;
  placeholder: string;
  defaultValue?: string;
}

const requirements: Requirement[] = [
  {
    group: 'admin',
    name: 'ELAGENTE_HARNESS_ADMIN_BASE_URL',
    required: false,
    description: 'Harness admin API base URL. Defaults to the production Harness deployment.',
    placeholder: 'https://elagenteharness-production.up.railway.app',
    defaultValue: 'https://elagenteharness-production.up.railway.app',
  },
  {
    group: 'admin',
    name: 'ELAGENTE_HARNESS_ADMIN_KEY',
    required: true,
    description: 'Harness ADMIN_KEY used only by the admin smoke.',
    placeholder: '<actual Harness ADMIN_KEY>',
  },
  {
    group: 'staging',
    name: 'STAGING_CONTROL_PLANE_BASE_URL',
    required: false,
    description: 'Remote Codex control-plane base URL. Defaults to the Railway control-plane API deployment.',
    placeholder: 'https://remote-codex-control-plane-production.up.railway.app',
    defaultValue: 'https://remote-codex-control-plane-production.up.railway.app',
  },
  {
    group: 'staging',
    name: 'STAGING_PRODUCT_JWT',
    required: false,
    description: 'Optional override. If absent, staging smoke logs in with STAGING_LOGIN_EMAIL/PASSWORD.',
    placeholder: '<product jwt>',
  },
  {
    group: 'staging',
    name: 'STAGING_LOGIN_EMAIL',
    required: false,
    description: 'Password-login email used to derive the product JWT.',
    placeholder: 'dev@example.com',
    defaultValue: 'dev@example.com',
  },
  {
    group: 'staging',
    name: 'STAGING_LOGIN_PASSWORD',
    required: false,
    description: 'Password-login password used to derive the product JWT.',
    placeholder: '<staging login password>',
  },
  {
    group: 'staging',
    name: 'STAGING_HARNESS_SMOKE',
    required: false,
    description: 'Set to 1 to enable Harness checks in staging-phase-one smoke. The evidence collector defaults this to 1.',
    placeholder: '1',
    defaultValue: '1',
  },
  {
    group: 'staging',
    name: 'STAGING_HARNESS_MODULE',
    required: false,
    description: 'Harness module for worker discovery and low-cost invoke evidence.',
    placeholder: 'farmaco',
    defaultValue: 'farmaco',
  },
  {
    group: 'invoke',
    name: 'STAGING_HARNESS_INVOKE_TOOL',
    required: false,
    description: 'Low-cost Harness tool for release invoke evidence. Basic worker smoke can omit it.',
    placeholder: '<low-cost Harness tool>',
  },
  {
    group: 'invoke',
    name: 'STAGING_HARNESS_INVOKE_INPUT_JSON',
    required: false,
    description: 'JSON object input for release invoke evidence. Basic worker smoke can omit it.',
    placeholder: '<json object>',
  },
  {
    group: 'agent-ui',
    name: 'STAGING_HARNESS_MCP_SMOKE_COMMAND',
    required: false,
    description: 'Optional release proof for Codex plugin/MCP path. Command must emit top-level JSON source=\"worker-api\".',
    placeholder: '<command>',
  },
  {
    group: 'agent-ui',
    name: 'STAGING_HARNESS_THREAD_ARTIFACT_UI_SMOKE_COMMAND',
    required: false,
    description: 'Optional release proof for thread UI artifact rendering. Command must emit live thread artifactTypes JSON.',
    placeholder: '<command>',
  },
  {
    group: 'k8s',
    name: 'HARNESS_K8S_NAMESPACE',
    required: false,
    description: 'Kubernetes namespace containing the Harness app-key Secret. Defaults to the staging namespace for K8s proof.',
    placeholder: 'remote-codex-staging',
    defaultValue: 'remote-codex-staging',
  },
  {
    group: 'k8s',
    name: 'ELAGENTE_HARNESS_APP_KEY_SECRET_NAME',
    required: false,
    description: 'Kubernetes Secret name for sandbox Harness app keys. Defaults to the configured staging secret name.',
    placeholder: 'remote-codex-harness-app-keys',
    defaultValue: 'remote-codex-harness-app-keys',
  },
  {
    group: 'k8s',
    name: 'HARNESS_K8S_SECRET_KEY',
    required: false,
    description: 'Secret key to verify, normally derived from the sandbox id after staging smoke.',
    placeholder: '<sandbox id>',
  },
  {
    group: 'review',
    name: 'HARNESS_EVIDENCE_REVIEWED_BY',
    required: false,
    description: 'Operator identity recorded in evidence-review.json.',
    placeholder: '<operator identity>',
  },
];

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function outputFormat() {
  const format = argValue('--format') ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error('--format must be json or text.');
  }
  return format;
}

function isPlaceholderValue(value: string) {
  return /<[^>]+>/.test(value.trim());
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && !isPlaceholderValue(value) ? value : null;
}

function requirementPresent(requirement: Requirement) {
  return Boolean(envValue(requirement.name) ?? requirement.defaultValue);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildEnvTemplate(generatedAt: string) {
  const lines = [
    '# Harness integration evidence env template',
    `# Generated at ${generatedAt}`,
    '# Fill this file in a private operator shell, then run: source <this file>',
    '# Do not commit this file after replacing placeholders.',
  ];
  let currentGroup = '';
  for (const requirement of requirements) {
    if (requirement.group !== currentGroup) {
      currentGroup = requirement.group;
      lines.push('', `# ${currentGroup}`);
    }
    lines.push(`export ${requirement.name}=${shellQuote(requirement.placeholder)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildReport() {
  const groups = ['admin', 'staging', 'invoke', 'agent-ui', 'k8s', 'optional', 'review'] as const;
  return {
    ok: requirements.filter((entry) => entry.required).every((entry) => requirementPresent(entry)),
    generatedAt: new Date().toISOString(),
    defaults: Object.fromEntries(
      requirements
        .filter((entry) => entry.defaultValue)
        .map((entry) => [entry.name, entry.defaultValue]),
    ),
    groups: groups.map((group) => {
      const groupRequirements = requirements.filter((entry) => entry.group === group);
      const missingRequired = groupRequirements
        .filter((entry) => entry.required && !requirementPresent(entry))
        .map((entry) => entry.name);
      return {
        id: group,
        ready: missingRequired.length === 0,
        required: groupRequirements.filter((entry) => entry.required).map((entry) => entry.name),
        optional: groupRequirements.filter((entry) => !entry.required).map((entry) => entry.name),
        present: groupRequirements.filter((entry) => Boolean(envValue(entry.name))).map((entry) => entry.name),
        defaulted: groupRequirements
          .filter((entry) => !envValue(entry.name) && entry.defaultValue)
          .map((entry) => entry.name),
        missingRequired,
      };
    }),
    missingRequired: requirements
      .filter((entry) => entry.required && !requirementPresent(entry))
      .map((entry) => ({
        group: entry.group,
        name: entry.name,
        description: entry.description,
      })),
    nextCommands: {
      writeTemplate:
        'pnpm verify:harness-evidence-env -- --write-env-template ./.temp/harness-evidence/harness.env.sh',
      sourceTemplate: 'source ./.temp/harness-evidence/harness.env.sh',
      collectEvidence:
        'pnpm collect:harness-integration-evidence -- --output-dir ./.temp/harness-evidence/latest',
    },
    secretSafety: {
      valuesPrinted: false,
      note: 'This report prints environment variable names only; it never prints ADMIN_KEY, product JWT, route tokens, or Harness app keys.',
    },
  };
}

function renderText(report: ReturnType<typeof buildReport>) {
  const lines = [
    `Harness evidence env ready: ${report.ok ? 'yes' : 'no'}`,
    '',
    'Groups:',
    ...report.groups.map((group) =>
      `- ${group.id}: ${group.ready ? 'ready' : `missing ${group.missingRequired.join(', ')}`}`,
    ),
    '',
    'Next commands:',
    `- ${report.nextCommands.writeTemplate}`,
    `- ${report.nextCommands.sourceTemplate}`,
    `- ${report.nextCommands.collectEvidence}`,
    '',
    report.secretSafety.note,
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const report = buildReport();
  const templatePath = argValue('--write-env-template');
  if (templatePath) {
    const parent = path.dirname(templatePath);
    if (parent && parent !== '.') {
      await mkdir(parent, { recursive: true });
    }
    await writeFile(templatePath, buildEnvTemplate(report.generatedAt));
  }

  const output = {
    ...report,
    envTemplatePath: templatePath,
  };
  if (outputFormat() === 'text') {
    console.log(renderText(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
