#!/usr/bin/env python3
"""Isolated native updater process smoke test. No npm, Relay or model requests."""
import argparse
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request


def smoke(binary):
    if os.name != 'posix':
        raise SystemExit('This process-lifecycle fixture is for POSIX hosts')
    version = subprocess.check_output([str(binary), 'version'], text=True).strip()
    with tempfile.TemporaryDirectory(prefix='native-update-smoke-') as temporary:
        root = pathlib.Path(temporary)
        release = root / '.local/share/remote-codex/native/releases' / version
        release.mkdir(parents=True)
        installed_binary = release / 'pockymoe'
        shutil.copyfile(binary, installed_binary)
        installed_binary.chmod(0o700)
        (release / 'web').mkdir()
        (release / 'web/index.html').write_text('<html>isolated native updater fixture</html>')
        installed = dict(version=version, executable=str(installed_binary), webDist=str(release / 'web'))
        (release / 'installed.json').write_text(json.dumps(installed))
        (release.parent.parent / 'current.json').write_text(json.dumps(installed))
        database = root / 'device.sqlite'
        workspace = root / 'workspace'
        workspace.mkdir()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        env = {k: v for k, v in os.environ.items() if not k.startswith('POCKYMOE_') and k not in ('DATABASE_URL', 'WORKSPACE_ROOT', 'TMUX', 'TMUX_PANE')}
        env.update(HOME=str(root), USERPROFILE=str(root), POCKYMOE_DATABASE_PATH=str(database), POCKYMOE_WORKSPACE_ROOT=str(workspace), POCKYMOE_E2E_FAKE_RUNTIME='1', POCKYMOE_HOST='127.0.0.1', POCKYMOE_PORT=str(port), HOST='127.0.0.1', PORT=str(port), POCKYMOE_MODE='local')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        def request(route, post=False):
            query = urllib.request.Request(f'http://127.0.0.1:{port}{route}', data=b'{}' if post else None, headers={'Content-Type': 'application/json'})
            with opener.open(query, timeout=3) as response:
                return json.load(response)
        def wait(predicate, seconds=30):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                try:
                    result = predicate()
                    if result:
                        return result
                except (OSError, ValueError):
                    pass
                time.sleep(0.1)
            raise AssertionError('Isolated updater fixture timed out')
        log_file = root / 'fixture.log'
        new_pid = None
        with log_file.open('w') as log:
            process = subprocess.Popen([str(installed_binary), 'supervisor'], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            try:
                initial = wait(lambda: request('/healthz'))
                assert initial['processId'] == process.pid, initial
                status = request('/api/management/supervisor')
                assert status['manager'] == 'github-release' and status['canRestart'], status
                started = request('/api/management/supervisor/restart', post=True)
                assert started['job']['phase'] == 'preparing', started
                journal = database.parent / 'updates/supervisor-update.json'
                def completed():
                    nonlocal new_pid
                    process.poll()  # Reap the fixture child; kill(0) treats zombies as alive.
                    if not journal.is_file():
                        return None
                    job = json.loads(journal.read_text())
                    if job.get('phase') in ('failed', 'rolled-back', 'rollback-failed'):
                        raise AssertionError(job)
                    if job.get('phase') == 'completed':
                        health = request('/healthz')
                        new_pid = health['processId']
                        assert new_pid != initial['processId'], health
                        assert health['runningVersion'] == version, health
                        return job
                job = wait(completed, 60)
                process.wait(timeout=5)
                assert json.loads((release.parent.parent / 'current.json').read_text()) == installed
                assert not (database.parent / 'updates/supervisor-update.lock').exists()
                print(json.dumps(dict(ok=True, version=version, oldPid=initial['processId'], newPid=new_pid, phase=job['phase'], manager='github-release')))
            except BaseException:
                print(log_file.read_text())
                for worker_log in root.rglob('*.log'):
                    if worker_log != log_file: print(str(worker_log), worker_log.read_text())
                journal = database.parent / 'updates/supervisor-update.json'
                if journal.is_file(): print(journal.read_text())
                raise
            finally:
                if new_pid:
                    try:
                        os.kill(new_pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
                # Only terminate worker PIDs recorded by this isolated fixture.
                journal = database.parent / 'updates/supervisor-update.json'
                if journal.is_file():
                    worker_pid = json.loads(journal.read_text()).get('workerPid')
                    if worker_pid and worker_pid != os.getpid():
                        try:
                            os.kill(worker_pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                time.sleep(0.2)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=pathlib.Path, required=True)
    smoke(parser.parse_args().binary.resolve())
