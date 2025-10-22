import { Platform } from 'react-native';

export type DevLogEntry = {
  level: 'log' | 'warn' | 'error' | 'debug';
  message: string;
  stack?: string;
  fatal?: boolean;
  timestamp: number;
};

export type DevLogListener = (entry: DevLogEntry) => void;

let initialized = false;

export function initDevLogger(listener: DevLogListener) {
  if (initialized) return;
  initialized = true;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug ? console.debug : console.log;

  const defer = (fn: () => void) => {
    try {
      setTimeout(fn, 0);
    } catch {
      try {
        Promise.resolve().then(fn);
      } catch {
        fn();
      }
    }
  };

  console.log = (...args: any[]) => {
    defer(() => {
      try {
        listener({ level: 'log', message: formatArgs(args), timestamp: Date.now() });
      } catch {}
    });
    originalLog(...args);
  };

  console.warn = (...args: any[]) => {
    defer(() => {
      try {
        listener({ level: 'warn', message: formatArgs(args), timestamp: Date.now() });
      } catch {}
    });
    originalWarn(...args);
  };

  console.error = (...args: any[]) => {
    const msg = formatArgs(args);
    let stack: string | undefined;
    const maybeError = args.find(a => a && (a as any).stack);
    if (maybeError && typeof (maybeError as any).stack === 'string') stack = (maybeError as any).stack;
    defer(() => {
      try {
        listener({ level: 'error', message: msg, stack, timestamp: Date.now() });
      } catch {}
    });
    originalError(...args);
  };

  console.debug = (...args: any[]) => {
    defer(() => {
      try {
        listener({ level: 'debug', message: formatArgs(args), timestamp: Date.now() });
      } catch {}
    });
    originalDebug(...args);
  };

  const globalAny: any = global as any;
  const defaultHandler = globalAny.ErrorUtils && globalAny.ErrorUtils.getGlobalHandler ? globalAny.ErrorUtils.getGlobalHandler() : undefined;
  if (globalAny.ErrorUtils && globalAny.ErrorUtils.setGlobalHandler) {
    globalAny.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      defer(() => {
        try {
          listener({
            level: 'error',
            message: error?.message || String(error),
            stack: error?.stack,
            fatal: !!isFatal,
            timestamp: Date.now(),
          });
        } catch {}
      });
      if (typeof defaultHandler === 'function') defaultHandler(error, isFatal);
    });
  }
}

function formatArgs(args: any[]): string {
  return args
    .map(a => {
      try {
        if (typeof a === 'string') return a;
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}