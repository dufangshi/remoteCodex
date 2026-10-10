import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';
import { confirmWorkspaceDocumentLeave } from '@pockymoe/thread-ui';

/** BrowserRouter does not offer data-router blockers. Guard its navigator and
 * native popstate while preserving search/hash updates inside the same thread. */
export function WorkspaceDocumentNavigationGuard({
  children,
}: {
  children: ReactNode;
}) {
  const context = useContext(UNSAFE_NavigationContext);
  const value = useMemo(
    () => ({
      ...context,
      navigator: {
        ...context.navigator,
        push: (...args: Parameters<typeof context.navigator.push>) => {
          const target =
            typeof args[0] === 'string'
              ? new URL(args[0], window.location.href).pathname
              : args[0].pathname;
          if (
            !target ||
            target === window.location.pathname ||
            confirmWorkspaceDocumentLeave()
          )
            context.navigator.push(...args);
        },
        replace: (...args: Parameters<typeof context.navigator.replace>) => {
          const target =
            typeof args[0] === 'string'
              ? new URL(args[0], window.location.href).pathname
              : args[0].pathname;
          if (
            !target ||
            target === window.location.pathname ||
            confirmWorkspaceDocumentLeave()
          )
            context.navigator.replace(...args);
        },
      },
    }),
    [context],
  );
  useEffect(() => {
    let previousPath = window.location.pathname;
    let previousIndex = window.history.state?.idx ?? 0;
    let restoring = false;
    const remember = () => {
      previousPath = window.location.pathname;
      previousIndex = window.history.state?.idx ?? 0;
    };
    const pop = (event: PopStateEvent) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (
        window.location.pathname !== previousPath &&
        !confirmWorkspaceDocumentLeave()
      ) {
        event.stopImmediatePropagation();
        const delta = previousIndex - (event.state?.idx ?? 0);
        if (delta) {
          restoring = true;
          window.history.go(delta);
        }
        return;
      }
      remember();
    };
    window.addEventListener('popstate', pop, true);
    // Navigator push/replace changes do not emit popstate; retain its latest idx.
    const push = window.history.pushState.bind(window.history),
      replace = window.history.replaceState.bind(window.history);
    window.history.pushState = (...args) => {
      push(...args);
      remember();
    };
    window.history.replaceState = (...args) => {
      replace(...args);
      remember();
    };
    return () => {
      window.removeEventListener('popstate', pop, true);
      window.history.pushState = push;
      window.history.replaceState = replace;
    };
  }, []);
  return (
    <UNSAFE_NavigationContext.Provider value={value}>
      {children}
    </UNSAFE_NavigationContext.Provider>
  );
}
