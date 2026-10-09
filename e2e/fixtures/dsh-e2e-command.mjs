// Harmless DSH plugin command for E2E: shows that commands registered by DSH
// plugins run from the Remote Codex panel. It has no side effects.
export const name = 'remote-codex-e2e-command';
export const inject = ['commands'];

export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'e2e-echo',
    description: 'Echo the arguments (Remote Codex E2E)',
    input: { hint: '<text>' },
    handler: async invocation => ({ kind: 'success', text: `E2E_ECHO ${invocation.rawInput.trim()}` }),
  }), 'e2e-echo command');
}
