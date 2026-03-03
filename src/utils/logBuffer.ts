/**
 * In-memory log buffer for debugging when Xcode/Metro don't show JS logs.
 * Call initLogBuffer() early (e.g. index.js). View logs in Dev Tools → View Logs.
 */

const MAX_LINES = 800;
const LOG_LINES: Array<{level: string; time: string; args: string}> = [];

function formatArgs(args: unknown[]): string {
  return args
    .map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object' && a instanceof Error) return a.stack ?? a.message;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a, null, 0);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

function addLog(level: string, args: unknown[]) {
  const time = new Date().toISOString();
  const argsStr = formatArgs(args);
  LOG_LINES.push({level, time, args: argsStr});
  if (LOG_LINES.length > MAX_LINES) {
    LOG_LINES.splice(0, LOG_LINES.length - MAX_LINES);
  }
}

/**
 * Call once at app startup (e.g. in index.js) to capture console.log/warn/error.
 */
export function initLogBuffer() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    addLog('log', args);
    origLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    addLog('warn', args);
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    addLog('error', args);
    origError.apply(console, args);
  };
}

/**
 * Get recent log lines (newest last). Used by LogViewerScreen.
 */
export function getLogLines(): Array<{level: string; time: string; args: string}> {
  return [...LOG_LINES];
}

/**
 * Get logs as a single string (e.g. for copy/share).
 */
export function getLogsAsText(): string {
  return LOG_LINES.map(({level, time, args}) => `[${time}] ${level}: ${args}`).join('\n');
}

/**
 * Clear the in-memory buffer.
 */
export function clearLogBuffer(): void {
  LOG_LINES.length = 0;
}
