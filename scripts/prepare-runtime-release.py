#!/usr/bin/env python3
"""Assemble one immutable, complete GitHub runtime release; no npm packages."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import zipfile

PLATFORMS = {
    'darwin-arm64': ('remote-codex', 'remote-codex-darwin-arm64'),
    'linux-arm64-gnu': ('remote-codex', 'remote-codex-linux-arm64-gnu'),
    'linux-x64-gnu': ('remote-codex', 'remote-codex-linux-x64-gnu'),
    'win32-x64-msvc': ('remote-codex.exe', 'remote-codex-win32-x64-msvc-cli.exe'),
}

def prepare(artifacts, web, out, version):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ValueError('A stable runtime version is required')
    if not (web / 'index.html').is_file():
        raise ValueError('Web build is incomplete: no index.html')
    binaries = [(artifacts / key / source, target) for key, (source, target) in PLATFORMS.items()]
    for source, _ in binaries:
        if not source.is_file() or source.stat().st_size == 0:
            raise ValueError(f'Missing native release artifact: {source}')
    out.mkdir(parents=True, exist_ok=False)
    for source, target in binaries:
        shutil.copyfile(source, out / target)
        (out / target).chmod(0o755)
    with zipfile.ZipFile(out / 'remote-codex-web.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for source in sorted(web.rglob('*')):
            if source.is_symlink():
                raise ValueError(f'Web build contains a symlink: {source}')
            if source.is_file():
                info = zipfile.ZipInfo(source.relative_to(web).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, source.read_bytes())
    (out / 'runtime-version.txt').write_text(version + '\n')
    sums = []
    for asset in sorted(out.iterdir()):
        sums.append(f'{hashlib.sha256(asset.read_bytes()).hexdigest()}  {asset.name}\n')
    (out / 'SHA256SUMS').write_text(''.join(sums))
    print(f'Assembled complete GitHub runtime {version}: {len(sums)} checked assets')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts-dir', type=pathlib.Path, required=True)
    parser.add_argument('--web-dir', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    version = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'package.json').read_text())['version']
    prepare(args.artifacts_dir, args.web_dir, args.out, version)
