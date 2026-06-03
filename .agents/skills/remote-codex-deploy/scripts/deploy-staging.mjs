#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

const EXPECTED_BRANCH = 'sandbox-worker-control-plane';
const CONTROL_PLANE_HEALTH =
  'https://remote-codex-control-plane-production.up.railway.app/healthz';
const ROUTER_HEALTH = 'https://sandbox-router.lnz.app/healthz';
const FRONTEND_URL = 'https://remote-codex-frontend-production.up.railway.app/control-plane';
const STAGING_WORKFLOW = 'Staging Images';
const WORKER_WORKFLOW = 'Worker Image';

function usage() {
  console.log(`Remote Codex staging deploy helper

Usage:
  node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs [options]

Options:
  --status                 Print branch, git status, recent runs, and health.
  --commit <message>       git add -A and commit with the given message.
  --push                   Push the current branch.
  --watch                  Wait for the latest Staging Images run for HEAD.
  --branch <name>          Expected branch. Default: ${EXPECTED_BRANCH}
  --timeout-minutes <n>    Watch timeout. Default: 30.
  --no-health              Skip health endpoint checks.
  --help                   Show this help.

Examples:
  node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --push --watch
  node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --commit "Fix session UI" --push --watch
  node .agents/skills/remote-codex-deploy/scripts/deploy-staging.mjs --status
`);
}

function parseArgs(argv) {
  const args = {
    status: false,
    commit: null,
    push: false,
    watch: false,
    branch: EXPECTED_BRANCH,
    timeoutMinutes: 30,
    health: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--status') {
      args.status = true;
      continue;
    }
    if (arg === '--push') {
      args.push = true;
      continue;
    }
    if (arg === '--watch') {
      args.watch = true;
      continue;
    }
    if (arg === '--no-health') {
      args.health = false;
      continue;
    }
    if (arg === '--commit') {
      args.commit = requiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--branch') {
      args.branch = requiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--timeout-minutes') {
      const value = Number(requiredValue(argv, index, arg));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-minutes must be a positive number.');
      }
      args.timeoutMinutes = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${arg} requires a value.`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed.${details}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function git(args, options) {
  return run('git', args, options);
}

function gh(args, options) {
  return run('gh', args, options);
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  return result.status === 0;
}

function assertRepoRoot() {
  const root = git(['rev-parse', '--show-toplevel'], { capture: true });
  process.chdir(root);
  if (!commandExists('gh')) {
    throw new Error('GitHub CLI (gh) is required for workflow lookup and watch.');
  }
}

function currentBranch() {
  return git(['branch', '--show-current'], { capture: true });
}

function currentSha() {
  return git(['rev-parse', 'HEAD'], { capture: true });
}

function shortSha(sha) {
  return sha.slice(0, 7);
}

function statusLines() {
  return git(['status', '--short'], { capture: true });
}

function printHeading(text) {
  console.log(`\n== ${text} ==`);
}

function printGitStatus(expectedBranch) {
  printHeading('Repository');
  const branch = currentBranch();
  const sha = currentSha();
  console.log(`branch: ${branch}`);
  console.log(`head: ${sha}`);
  if (branch !== expectedBranch) {
    throw new Error(`Expected branch ${expectedBranch}, got ${branch}.`);
  }
  const status = statusLines();
  console.log(status ? status : 'working tree clean');
}

function commitAll(message) {
  const before = statusLines();
  if (!before) {
    console.log('No changes to commit.');
    return;
  }
  git(['add', '-A']);
  git(['commit', '-m', message]);
}

function pushBranch() {
  git(['push']);
}

function assertCleanForDeploy() {
  const status = statusLines();
  if (status) {
    throw new Error(
      'Working tree is dirty. Commit the deployable changes first, or rerun with --commit "<message>".',
    );
  }
}

function recentRuns() {
  const json = gh([
    'run',
    'list',
    '-L',
    '8',
    '--json',
    'databaseId,name,headSha,status,conclusion,updatedAt,url,event,headBranch',
  ], { capture: true });
  return JSON.parse(json);
}

function printRecentRuns() {
  printHeading('Recent GitHub Runs');
  for (const run of recentRuns()) {
    const conclusion = run.conclusion || run.status;
    console.log(`${run.name} ${conclusion} ${shortSha(run.headSha)} ${run.url}`);
  }
}

function latestRunForHead(workflowName, sha) {
  return recentRuns().find((run) => run.name === workflowName && run.headSha === sha);
}

function waitForRunDiscovery(workflowName, sha, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = latestRunForHead(workflowName, sha);
    if (run) {
      return run;
    }
    execFileSync('sleep', ['5']);
  }
  throw new Error(`No ${workflowName} run appeared for ${sha}.`);
}

function watchStagingRun(sha, timeoutMinutes) {
  printHeading('Watch Deployment');
  const run = waitForRunDiscovery(STAGING_WORKFLOW, sha, 120_000);
  console.log(`${STAGING_WORKFLOW}: ${run.url}`);
  const result = spawnSync(
    'gh',
    ['run', 'watch', String(run.databaseId), '--interval', '20', '--exit-status'],
    {
      encoding: 'utf8',
      stdio: 'inherit',
      timeout: timeoutMinutes * 60 * 1000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${STAGING_WORKFLOW} did not complete successfully.`);
  }

  const worker = latestRunForHead(WORKER_WORKFLOW, sha);
  if (worker) {
    console.log(`${WORKER_WORKFLOW}: ${worker.conclusion || worker.status} ${worker.url}`);
  }
}

function fetchJson(url) {
  const output = run('curl', ['-fsS', url], { capture: true });
  return JSON.parse(output);
}

function checkHealth(sha) {
  printHeading('Live Health');
  const controlPlane = fetchJson(CONTROL_PLANE_HEALTH);
  console.log(`${CONTROL_PLANE_HEALTH}`);
  console.log(JSON.stringify(controlPlane));
  if (controlPlane.buildSha && controlPlane.buildSha !== sha) {
    throw new Error(
      `control-plane buildSha mismatch: expected ${sha}, got ${controlPlane.buildSha}`,
    );
  }

  const router = fetchJson(ROUTER_HEALTH);
  console.log(`${ROUTER_HEALTH}`);
  console.log(JSON.stringify(router));
}

function printSmokeHint() {
  printHeading('Frontend Smoke');
  console.log(`Open: ${FRONTEND_URL}`);
  console.log('For UI changes, verify the changed route with Playwright or a browser.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertRepoRoot();
  printGitStatus(args.branch);

  if (args.commit) {
    printHeading('Commit');
    commitAll(args.commit);
  }

  if ((args.push || args.watch) && statusLines()) {
    assertCleanForDeploy();
  }

  const sha = currentSha();

  if (args.push) {
    printHeading('Push');
    pushBranch();
  }

  if (args.watch) {
    watchStagingRun(sha, args.timeoutMinutes);
  }

  if (args.status || !args.watch) {
    printRecentRuns();
  }

  if (args.health) {
    checkHealth(sha);
  }

  printSmokeHint();
}

try {
  main();
} catch (error) {
  console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
