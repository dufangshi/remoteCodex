#!/usr/bin/env python3
"""Publish only a prebuilt Treer console bundle; no npm/build/deploy commands."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

REPO = 'dufangshi/remoteCodex'
APP_ID = 'org.remote-codex.console'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(bundle, out):
    raw = bundle.read_bytes()
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Bundle exceeds Treer import limit')
    data = json.loads(raw)
    manifest = data['manifest']
    version = manifest['version']
    if data['format'] != 'treer.app.bundle/v1' or manifest['schema'] != 'treer.app/v1':
        raise ValueError('Unsupported App schema')
    if manifest['id'] != APP_ID or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        raise ValueError('Expected the stable Remote Codex console App')
    if not manifest.get('frontend') or any(c['placement'] != 'browser' for c in manifest['components']):
        raise ValueError('This publisher accepts browser components only, never native runtimes')
    paths = set()
    for entry in data['files']:
        path = entry['path']
        if path in paths or path.startswith('/') or '\\' in path or any(p in ('', '.', '..') for p in path.split('/')):
            raise ValueError('Unsafe/duplicate bundle path')
        paths.add(path)
        if digest(base64.b64decode(entry['data'], validate=True)) != entry['sha256']:
            raise ValueError('Bundle file checksum mismatch')
    if not paths:
        raise ValueError('Empty bundle')
    asset = f'remote-codex-console-{version}.treer-app.json'
    index = {'schema': 'treer.app.release/v1', 'apps': [{
        'app_id': APP_ID, 'version': version, 'asset': asset, 'sha256': digest(raw)}]}
    out.mkdir(parents=True, exist_ok=True)
    (out / asset).write_bytes(raw)
    (out / 'treer-app-release.json').write_text(json.dumps(index, indent=2) + '\n')
    return version, [out / 'treer-app-release.json', out / asset], index


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True).strip()


def publish(version, assets, index, target):
    if not re.fullmatch(r'[a-f0-9]{40}', target or ''):
        raise ValueError('--target must be a pushed full source commit SHA')
    tag = f'treer-app-remote-codex-console-v{version}'
    # Never use v<VERSION>, a runtime Release, or the repository-wide Latest marker.
    before = json.loads(gh('api', f'repos/{REPO}/releases/latest'))['id']
    with tempfile.TemporaryDirectory(prefix='treer-app-publish-') as directory:
        tmp = Path(directory)
        notes = tmp / 'notes.md'
        notes.write_text(f'''Independent Treer browser App release ({version}).

Subscribe in Treer with `https://github.com/{REPO}` and App ID `{APP_ID}`.
The `treer-app-release.json` index names the immutable bundle and its SHA-256.

This is a Treer frontend integration built from pinned upstream revisions recorded
in the bundle manifest, not a new standalone Remote Codex runtime. It does not
publish NPM packages, replace runtime binaries or Windows installers, or deploy relay.
Repository-wide Latest remains the existing runtime release.

Bundle SHA-256: `{index['apps'][0]['sha256']}`
Publisher source: `{target}`
''')
        # A new release/tag only. Existing tags fail; no clobber or edit of runtime releases.
        gh('release', 'create', tag, *map(str, assets), '--repo', REPO,
           '--target', target, '--draft', '--latest=false', '--title',
           f'Treer App: Remote Codex console {version}', '--notes-file', str(notes))
        downloaded = tmp / 'download'
        gh('release', 'download', tag, '--repo', REPO, '--dir', str(downloaded))
        for asset in assets:
            if (downloaded / asset.name).read_bytes() != asset.read_bytes():
                raise ValueError('Uploaded asset differs; release left as draft')
        gh('release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest=false')
    after = json.loads(gh('api', f'repos/{REPO}/releases/latest'))['id']
    if after != before:
        raise RuntimeError('Repository Latest changed concurrently; inspect before further publication')
    return f'https://github.com/{REPO}/releases/tag/{tag}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--target', help='Full pushed commit SHA for the independent release tag')
    parser.add_argument('--publish', action='store_true', help='Upload, verify, then publish a new non-Latest GitHub Release')
    args = parser.parse_args()
    version, assets, index = prepare(args.bundle.resolve(), args.out.resolve())
    print(json.dumps(index, indent=2))
    if args.publish:
        print(publish(version, assets, index, args.target))
    else:
        print('Prepared locally; nothing published. Add --publish --target FULL_SHA to publish.')


if __name__ == '__main__':
    main()
