//Production ready Logger, Supports structured logging, log levels, and performance tracking

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  duration?: number;
  requestId?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Determine minimum log level from environment
const getMinLogLevel = (): number => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;
};

export class Logger {
  private minLevel: number;
  private static instance: Logger;

  constructor() {
    this.minLevel = getMinLogLevel();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, any>): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    };

    // In production, output JSON for log aggregation
    if (process.env.NODE_ENV === 'production') {
      return JSON.stringify(entry);
    }

    // In development, use human readable format with colors
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    
    const contextStr = context 
      ? ' ' + Object.entries(context)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ')
      : '';

    return `${colors[level]}[${entry.timestamp}] ${level.toUpperCase()}${reset}: ${message}${contextStr}`;
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: Error | unknown, context?: Record<string, any>): void {
    if (this.shouldLog('error')) {
      const errorContext: Record<string, any> = { ...context };
      
      if (error instanceof Error) {
        errorContext.errorName = error.name;
        errorContext.errorMessage = error.message;
        errorContext.stack = error.stack;
      } else if (error) {
        errorContext.error = String(error);
      }
      
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  // Performance timing helper
  time(label: string): () => void {
    const start = performance.now();
    return () => {
      const duration = Math.round(performance.now() - start);
      this.debug(`${label} completed`, { duration: `${duration}ms` });
    };
  }

  // Log with request context
  withRequestId(requestId: string): RequestLogger {
    return new RequestLogger(this, requestId);
  }
}

class RequestLogger {
  constructor(private logger: Logger, private requestId: string) {}

  debug(message: string, context?: Record<string, any>): void {
    this.logger.debug(message, { ...context, requestId: this.requestId });
  }

  info(message: string, context?: Record<string, any>): void {
    this.logger.info(message, { ...context, requestId: this.requestId });
  }

  warn(message: string, context?: Record<string, any>): void {
    this.logger.warn(message, { ...context, requestId: this.requestId });
  }

  error(message: string, error?: Error | unknown, context?: Record<string, any>): void {
    this.logger.error(message, error, { ...context, requestId: this.requestId });
  }
}

export const logger = Logger.getInstance();
