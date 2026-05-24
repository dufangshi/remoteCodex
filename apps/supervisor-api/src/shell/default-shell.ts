import fs from 'node:fs';

const POSIX_SHELL_CANDIDATES = ['/bin/bash', '/usr/bin/bash', '/bin/sh'];

export function resolveDefaultShell(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform === 'win32') {
    return env.COMSPEC ?? 'cmd.exe';
  }

  if (env.SHELL && fs.existsSync(env.SHELL)) {
    return env.SHELL;
  }

  return POSIX_SHELL_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? '/bin/sh';
}
