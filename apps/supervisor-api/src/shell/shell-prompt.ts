import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { TmuxManager } from './tmux-manager';

export function basenameFromPath(filePath: string | null | undefined) {
  if (!filePath) {
    return '';
  }

  const normalized = filePath.replace(/[\\/]+$/, '');
  if (!normalized) {
    return '';
  }

  return path.basename(normalized) || normalized;
}

export function isInteractiveShellCommand(command: string | null | undefined) {
  const normalized = (command ?? '').trim().toLowerCase();
  return new Set([
    'zsh',
    'bash',
    'sh',
    'dash',
    'ksh',
    'fish',
    'tcsh',
    'csh',
    'login',
  ]).has(normalized);
}

function extractEnvironmentValue(environmentText: string, key: string) {
  const marker = `${key}=`;
  const start = environmentText.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const valueStart = start + marker.length;
  const remainder = environmentText.slice(valueStart);
  const nextVariableMatch = remainder.match(/\s+[A-Z_][A-Z0-9_]*=/);
  const value = nextVariableMatch
    ? remainder.slice(0, nextVariableMatch.index)
    : remainder;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveEnvironmentPrefix(environmentText: string) {
  const condaPromptModifier = extractEnvironmentValue(
    environmentText,
    'CONDA_PROMPT_MODIFIER',
  );
  if (condaPromptModifier) {
    return condaPromptModifier.trim();
  }

  const condaDefaultEnv = extractEnvironmentValue(
    environmentText,
    'CONDA_DEFAULT_ENV',
  );
  if (condaDefaultEnv) {
    return `(${condaDefaultEnv})`;
  }

  const virtualEnvPrompt = extractEnvironmentValue(
    environmentText,
    'VIRTUAL_ENV_PROMPT',
  );
  if (virtualEnvPrompt) {
    return virtualEnvPrompt.trim();
  }

  const virtualEnvPath = extractEnvironmentValue(environmentText, 'VIRTUAL_ENV');
  if (virtualEnvPath) {
    const name = basenameFromPath(virtualEnvPath);
    if (name) {
      return `(${name})`;
    }
  }

  return null;
}

export async function resolvePaneEnvironmentPrefix(
  tmuxManager: TmuxManager,
  sessionName: string,
  panePid: number,
) {
  const sessionPrefix = await tmuxManager.getSessionEnvironmentVariable(
    sessionName,
    'REMOTE_CODEX_ENV_PREFIX',
  );
  if (sessionPrefix) {
    return sessionPrefix;
  }

  try {
    const environment = await tmuxManager.readProcessEnvironment(panePid);
    return resolveEnvironmentPrefix(environment);
  } catch {
    return null;
  }
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellPromptInitScriptContents(command: string) {
  const normalized = command.trim().toLowerCase();

  if (normalized === 'zsh') {
    return (
      [
        'export CONDA_CHANGEPS1=no VIRTUAL_ENV_DISABLE_PROMPT=1',
        'typeset -ga precmd_functions',
        '__remote_codex_env_prefix() {',
        '  if [[ -n "${CONDA_PROMPT_MODIFIER:-}" ]]; then',
        '    print -r -- "${CONDA_PROMPT_MODIFIER% }"',
        '  elif [[ -n "${CONDA_DEFAULT_ENV:-}" ]]; then',
        '    print -r -- "(${CONDA_DEFAULT_ENV})"',
        '  elif [[ -n "${VIRTUAL_ENV_PROMPT:-}" ]]; then',
        '    print -r -- "${VIRTUAL_ENV_PROMPT% }"',
        '  elif [[ -n "${VIRTUAL_ENV:-}" ]]; then',
        '    print -r -- "(${VIRTUAL_ENV:t})"',
        '  fi',
        '}',
        '__remote_codex_sync_tmux_env_prefix() {',
        '  local prefix="$(__remote_codex_env_prefix)"',
        '  local session_name=""',
        '  if [[ -n "${TMUX:-}" ]]; then',
        `    session_name="$(tmux display-message -p '#S' 2>/dev/null || true)"`,
        '    if [[ -n "$session_name" ]]; then',
        '      if [[ -n "$prefix" ]]; then',
        '        tmux set-environment -t "$session_name" REMOTE_CODEX_ENV_PREFIX "$prefix" >/dev/null 2>&1 || true',
        '      else',
        '        tmux set-environment -u -t "$session_name" REMOTE_CODEX_ENV_PREFIX >/dev/null 2>&1 || true',
        '      fi',
        '    fi',
        '  fi',
        '}',
        '__remote_codex_prompt_precmd() {',
        '  __remote_codex_sync_tmux_env_prefix',
        '  PROMPT="$ "',
        '  RPROMPT=""',
        '}',
        'if (( ${precmd_functions[(Ie)__remote_codex_prompt_precmd]} == 0 )); then precmd_functions+=(__remote_codex_prompt_precmd); fi',
        '__remote_codex_prompt_precmd',
        '',
      ].join('\n')
    );
  }

  return (
    [
      'export CONDA_CHANGEPS1=no VIRTUAL_ENV_DISABLE_PROMPT=1',
      '__remote_codex_env_prefix() {',
      '  if [ -n "${CONDA_PROMPT_MODIFIER:-}" ]; then',
      '    printf "%s" "${CONDA_PROMPT_MODIFIER% }"',
      '  elif [ -n "${CONDA_DEFAULT_ENV:-}" ]; then',
      '    printf "(%s)" "${CONDA_DEFAULT_ENV}"',
      '  elif [ -n "${VIRTUAL_ENV_PROMPT:-}" ]; then',
      '    printf "%s" "${VIRTUAL_ENV_PROMPT% }"',
      '  elif [ -n "${VIRTUAL_ENV:-}" ]; then',
      '    printf "(%s)" "${VIRTUAL_ENV##*/}"',
      '  fi',
      '}',
      '__remote_codex_sync_tmux_env_prefix() {',
      '  prefix="$(__remote_codex_env_prefix)"',
      '  session_name=""',
      '  if [ -n "${TMUX:-}" ]; then',
      `    session_name="$(tmux display-message -p '#S' 2>/dev/null || true)"`,
      '    if [ -n "$session_name" ]; then',
      '      if [ -n "$prefix" ]; then',
      '        tmux set-environment -t "$session_name" REMOTE_CODEX_ENV_PREFIX "$prefix" >/dev/null 2>&1 || true',
      '      else',
      '        tmux set-environment -u -t "$session_name" REMOTE_CODEX_ENV_PREFIX >/dev/null 2>&1 || true',
      '      fi',
      '    fi',
      '  fi',
      '}',
      '__remote_codex_prompt_precmd() {',
      '  __remote_codex_sync_tmux_env_prefix',
      '  PS1="$ "',
      '}',
      'case ";$PROMPT_COMMAND;" in',
      '  *";__remote_codex_prompt_precmd;"*) ;;',
      '  *) PROMPT_COMMAND="__remote_codex_prompt_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
      'esac',
      '__remote_codex_prompt_precmd',
      '',
    ].join('\n')
  );
}

async function ensureShellPromptInitScript(command: string) {
  const normalized = command.trim().toLowerCase();
  const extension = normalized === 'zsh' ? 'zsh' : 'sh';
  const filePath = path.join(
    os.tmpdir(),
    `remote-codex-shell-prompt.${extension}`,
  );
  await fs.writeFile(filePath, buildShellPromptInitScriptContents(command), 'utf8');
  return filePath;
}

export async function buildShellPromptInitCommand(
  command: string,
  options: { clearScreen?: boolean } = {},
) {
  const scriptPath = await ensureShellPromptInitScript(command);
  const normalized = command.trim().toLowerCase();
  const sourceCommand =
    normalized === 'zsh'
      ? `source ${shellSingleQuote(scriptPath)} >/dev/null 2>&1`
      : `. ${shellSingleQuote(scriptPath)} >/dev/null 2>&1`;

  return options.clearScreen ? `${sourceCommand}\nclear\n` : `${sourceCommand}\n`;
}
