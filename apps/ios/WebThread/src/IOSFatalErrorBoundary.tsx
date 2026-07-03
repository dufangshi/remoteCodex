import { Component, type ErrorInfo, type ReactNode } from 'react';

import { postNativeMessage } from './IOSNativeBridge';

interface IOSFatalErrorBoundaryProps {
  children: ReactNode;
}

interface IOSFatalErrorBoundaryState {
  message: string | null;
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class IOSFatalErrorBoundary extends Component<
  IOSFatalErrorBoundaryProps,
  IOSFatalErrorBoundaryState
> {
  state: IOSFatalErrorBoundaryState = {
    message: null,
  };

  static getDerivedStateFromError(error: unknown): IOSFatalErrorBoundaryState {
    return {
      message: describeError(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const componentStack = info.componentStack?.trim();
    postNativeMessage({
      type: 'reportFatalError',
      message: componentStack
        ? `${describeError(error)}\n${componentStack}`
        : describeError(error),
    });
  }

  render() {
    if (this.state.message) {
      return (
        <div className="ios-thread-message" role="alert">
          {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function installGlobalFatalErrorReporter() {
  window.addEventListener('error', (event) => {
    postNativeMessage({
      type: 'reportFatalError',
      message: event.message || describeError(event.error),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    postNativeMessage({
      type: 'reportFatalError',
      message: describeError(event.reason),
    });
  });
}
