import { useEffect, useState, type RefObject } from 'react';

interface UseMobileComposerLayoutInput {
  activeView: 'chat' | 'shell';
  composerHostRef: RefObject<HTMLDivElement | null>;
  threadId: string;
}

export function useMobileComposerLayout({
  activeView,
  composerHostRef,
  threadId,
}: UseMobileComposerLayoutInput) {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileComposerHeight, setMobileComposerHeight] = useState(0);
  const [mobileComposerOverlap, setMobileComposerOverlap] = useState(0);
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [mobilePromptFocused, setMobilePromptFocused] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobileViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport;
      const keyboardInset = viewport
        ? Math.max(
            0,
            Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
          )
        : 0;
      setMobileKeyboardInset(keyboardInset);
      document.documentElement.style.setProperty(
        '--thread-detail-keyboard-inset',
        `${keyboardInset}px`,
      );
    };

    updateKeyboardInset();
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
      document.documentElement.style.removeProperty('--thread-detail-keyboard-inset');
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updatePromptFocus = () => {
      const activeElement = document.activeElement;
      const host = composerHostRef.current;
      const promptElement = host?.querySelector('[aria-label="Prompt"]');

      setMobilePromptFocused(
        Boolean(
          activeElement &&
            promptElement &&
            (activeElement === promptElement || promptElement.contains(activeElement)),
        ),
      );
    };

    updatePromptFocus();
    document.addEventListener('focusin', updatePromptFocus);
    document.addEventListener('focusout', updatePromptFocus);

    return () => {
      document.removeEventListener('focusin', updatePromptFocus);
      document.removeEventListener('focusout', updatePromptFocus);
    };
  }, [activeView, composerHostRef, isMobileViewport, threadId]);

  useEffect(() => {
    const node = composerHostRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const measuredNode =
      (node.querySelector('form') as HTMLFormElement | null) ?? node;

    const updateHeight = () => {
      setMobileComposerHeight(
        Math.max(
          node.getBoundingClientRect().height,
          measuredNode.getBoundingClientRect().height,
        ),
      );
    };

    updateHeight();
    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(measuredNode);
    return () => {
      observer.disconnect();
    };
  }, [activeView, composerHostRef, isMobileViewport]);

  useEffect(() => {
    const node = composerHostRef.current;
    if (!node || !isMobileViewport || activeView !== 'chat') {
      setMobileComposerOverlap(0);
      return;
    }

    const updateOverlap = () => {
      const rect = node.getBoundingClientRect();
      setMobileComposerOverlap(Math.max(0, Math.ceil(window.innerHeight - rect.top)));
    };

    updateOverlap();
    window.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('resize', updateOverlap);
    window.visualViewport?.addEventListener('scroll', updateOverlap);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateOverlap);
      observer.observe(node);
    }

    return () => {
      window.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('resize', updateOverlap);
      window.visualViewport?.removeEventListener('scroll', updateOverlap);
      observer?.disconnect();
    };
  }, [
    activeView,
    composerHostRef,
    isMobileViewport,
    mobileKeyboardInset,
    mobilePromptFocused,
    threadId,
  ]);

  const useFloatingMobileComposer = isMobileViewport && activeView === 'chat';
  const floatingMobileComposerBottomOffset =
    useFloatingMobileComposer && mobilePromptFocused ? mobileKeyboardInset : 0;
  const effectiveMobileComposerHeight = Math.max(mobileComposerHeight, 144);
  const effectiveMobileComposerOverlap = Math.max(
    mobileComposerOverlap,
    effectiveMobileComposerHeight + floatingMobileComposerBottomOffset,
  );
  const timelineBottomSpacer = useFloatingMobileComposer
    ? effectiveMobileComposerOverlap + 12
    : 0;

  return {
    floatingMobileComposerBottomOffset,
    timelineBottomSpacer,
    useFloatingMobileComposer,
  };
}
