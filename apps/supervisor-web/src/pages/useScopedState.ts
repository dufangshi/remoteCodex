import { useCallback, useRef, useState, type SetStateAction } from 'react';

// A route changes before effects run. Never expose data from the previous
// device/thread during that render, or accept its delayed request callbacks.
export function useScopedState<T>(scope: string, initial: T) {
  const currentScope = useRef({ scope });
  if (currentScope.current.scope !== scope) currentScope.current = { scope };
  const owner = currentScope.current;
  const [state, update] = useState({ owner, value: initial });
  const value = state.owner === owner ? state.value : initial;
  const set = useCallback((action: SetStateAction<T>) => {
    if (currentScope.current !== owner) return;
    update(previous => {
      if (currentScope.current !== owner) return previous;
      const value = previous.owner === owner ? previous.value : initial;
      return { owner, value: typeof action === 'function' ? (action as (value: T) => T)(value) : action };
    });
  }, [owner]);
  return [value, set] as const;
}
