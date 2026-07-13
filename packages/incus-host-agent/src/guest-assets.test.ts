import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const guestDir = path.resolve(import.meta.dirname, '../guest');

describe('hosted supervisor golden image assets', () => {
  it('pins the x86_64 toolchain and package versions', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(guestDir, 'image-manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      imageVersion: 'ubuntu-24.04-v5',
      architecture: 'x86_64',
      baseImageFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      node: {
        version: expect.stringMatching(/^22\./),
        sha256: expect.any(String),
      },
      codex: { package: '@openai/codex', version: expect.any(String) },
      remoteCodex: { package: 'remote-codex', version: expect.any(String) },
    });
  });

  it('keeps credentials off command arguments and locks persistent files down', () => {
    const provision = fs.readFileSync(
      path.join(guestDir, 'remote-codex-provision'),
      'utf8',
    );
    expect(provision).toContain('codex login --with-api-key');
    expect(provision).toContain(
      'chmod 0600 /home/remote-codex/.codex/config.toml /home/remote-codex/.codex/auth.json',
    );
    expect(provision).toContain("jq -jr '.codexFiles.configToml'");
    expect(provision).toContain('install -o root -g root -m 0600');
    expect(provision).not.toMatch(/codex login --with-api-key ["$]/);
    expect(provision).not.toContain('echo "${api_key}"');
    expect(provision).toContain('model_provider = ${model_provider_toml}');
    expect(provision).toContain('base_url = ${base_url_toml}');
    expect(provision).toContain('[features]');
    expect(provision).toContain('goals = ${goals}');
  });

  it('clears the builder machine identity before publishing the image', () => {
    const buildScript = fs.readFileSync(
      path.join(guestDir, 'build-golden-image.sh'),
      'utf8',
    );
    expect(buildScript).toContain('truncate -s 0 /etc/machine-id');
    expect(buildScript).toContain('rm -f /var/lib/dbus/machine-id');
  });

  it('ships a disabled-until-provisioned, hardened systemd service', () => {
    const unit = fs.readFileSync(
      path.join(guestDir, 'remote-codex-relay-supervisor.service'),
      'utf8',
    );
    expect(unit).toContain(
      'ConditionPathExists=/etc/remote-codex/supervisor.env',
    );
    expect(unit).toContain('User=remote-codex');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain(
      'ExecStart=/usr/local/bin/remote-codex relay-supervisor run',
    );
  });

  it('ships a health-checked runtime upgrader with package rollback', () => {
    const upgrade = fs.readFileSync(
      path.join(guestDir, 'remote-codex-upgrade-runtime'),
      'utf8',
    );
    expect(upgrade).toContain('npm install --global --omit=dev "remote-codex@${target_version}"');
    expect(upgrade).toContain('curl -fsS --max-time 2 http://127.0.0.1:8787/healthz');
    expect(upgrade).toContain('attempted rollback to ${previous_version:-unknown}');
    expect(upgrade).toContain('runtime-upgrade-backups');
    expect(upgrade).toContain("'.activeTurnCount");
    expect(upgrade).toContain('--on-unit-active=5m');
  });

  it('rolls running VMs one at a time and defers stopped VMs', () => {
    const rollout = fs.readFileSync(
      path.resolve(guestDir, '../deploy/rollout-runtime.sh'),
      'utf8',
    );
    expect(rollout).toContain('flock -n 9');
    expect(rollout).toContain('user.remote-codex.runtime-version');
    expect(rollout).toContain('it will upgrade to ${target_version} on its next start');
    expect(rollout).toContain('/usr/local/sbin/remote-codex-upgrade-runtime');
  });
});
