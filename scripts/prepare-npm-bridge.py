#!/usr/bin/env python3
"""Stage the final `remote-codex` npm release from a published GitHub runtime.

Devices installed from npm only check the npm registry, which stopped at
0.12.74, so they never see GitHub runtime releases. This package is the
retired launcher in npm/remote-codex at the GitHub runtime's version. Their
existing Update installs it, the launcher runs that version's verified GitHub
executable, and that runtime's own Update then moves the device to the native
GitHub installation. No further npm releases follow.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import zipfile

REPO = 'https://github.com/dufangshi/remoteCodex'
ASSETS = {
    'darwin-arm64': 'remote-codex-darwin-arm64',
    'linux-arm64-gnu': 'remote-codex-linux-arm64-gnu',
    'linux-x64-gnu': 'remote-codex-linux-x64-gnu',
    'win32-x64-msvc': 'remote-codex-win32-x64-msvc-cli.exe',
}
NOTE = (
    '> Final npm release. Pockymoe (formerly Remote Codex) is distributed through '
    f'[GitHub Releases]({REPO}/releases). After this version is installed, use '
    'Settings → Supervisor → Update once to move the device to the native runtime.\n\n'
)


def checksums(text):
    sums = {}
    for line in text.splitlines():
        digest, name = line.split(None, 1)
        if not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError(f'Invalid checksum line: {line}')
        sums[name.strip().lstrip('*')] = digest
    return sums


def prepare(release, launcher, license_file, out, version):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ValueError('A stable runtime version is required')
    if (release / 'runtime-version.txt').read_text().strip() != version:
        raise ValueError('The release directory is for a different version')
    sums = checksums((release / 'SHA256SUMS').read_text())
    assets = {}
    for key, name in ASSETS.items():
        data = (release / name).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if sums.get(name) != digest:
            raise ValueError(f'{name} does not match SHA256SUMS')
        assets[key] = {'name': name, 'sha256': digest, 'size': len(data)}
    web = release / 'remote-codex-web.zip'
    if sums.get(web.name) != hashlib.sha256(web.read_bytes()).hexdigest():
        raise ValueError(f'{web.name} does not match SHA256SUMS')

    shutil.copytree(launcher, out)
    manifest = json.loads((out / 'package.json').read_text())
    if manifest['name'] != 'remote-codex':
        raise ValueError('The retired launcher must keep its npm package name')
    manifest['version'] = version
    (out / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (out / 'native-manifest.json').write_text(json.dumps({
        'version': version,
        'releaseBaseUrl': f'{REPO}/releases/download/v{version}',
        'assets': assets,
    }, indent=2) + '\n')
    with zipfile.ZipFile(web) as archive:
        for member in archive.infolist():
            target = (out / 'web' / member.filename).resolve()
            if not str(target).startswith(str((out / 'web').resolve()) + '/'):
                raise ValueError(f'Unsafe path in web archive: {member.filename}')
        archive.extractall(out / 'web')
    if not (out / 'web' / 'index.html').is_file():
        raise ValueError('Web archive has no index.html')
    shutil.copyfile(license_file, out / 'LICENSE')
    readme = out / 'README.md'
    readme.write_text(NOTE + readme.read_text())
    print(f'Staged final remote-codex npm package {version} at {out}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    prepare(args.release_dir, root / 'npm' / 'remote-codex', root / 'LICENSE', args.out, args.version)
