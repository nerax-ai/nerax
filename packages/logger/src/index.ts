import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { format as utilFormat } from 'util';
import { join } from 'path';
import { getStorage } from '@nerax-ai/storage';
import type { Logger, LogConfig, LogFormat } from './types';

function makeLogger(w: winston.Logger, scopes: string[] = []): Logger {
  return {
    debug: (...args) => w.debug(utilFormat(...args)),
    info: (...args) => w.info(utilFormat(...args)),
    warn: (...args) => w.warn(utilFormat(...args)),
    error: (...args) => w.error(utilFormat(...args)),
    scope: (name) => {
      const next = [...scopes, name];
      return makeLogger(w.child({ scopes: next }), next);
    },
  };
}

function buildFormat(fmt: LogFormat, colorize = false): winston.Logform.Format {
  if (fmt === 'json') {
    return winston.format.combine(winston.format.timestamp(), winston.format.json());
  }
  return winston.format.combine(
    ...(colorize ? [winston.format.colorize()] : []),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, scopes, appName }: any) => {
      const parts = [appName, ...(Array.isArray(scopes) ? scopes : [])].filter(Boolean);
      const tag = parts.map((p) => `[${p}]`).join('');
      return tag ? `${timestamp} ${level} ${tag}: ${message}` : `${timestamp} ${level}: ${message}`;
    }),
  );
}

export function createLogger(config?: LogConfig): Logger {
  const level = config?.level ?? process.env.LOG_LEVEL ?? 'info';
  const baseDir = config?.baseDir ?? (config?.appName ? getStorage(config.appName).state.path : undefined);
  const transports: winston.transport[] = [];

  if (config?.console !== false) {
    transports.push(
      new winston.transports.Console({
        format: buildFormat(config?.consoleFormat ?? 'text', true),
      }),
    );
  }

  for (const fc of config?.files ?? []) {
    const filename = baseDir ? join(baseDir, fc.filename) : fc.filename;
    transports.push(
      new DailyRotateFile({
        level: fc.level,
        filename,
        maxSize: fc.maxSize ?? '20m',
        maxFiles: fc.maxFiles ?? '14d',
        format: buildFormat(fc.format ?? 'text'),
      }),
    );
  }

  return makeLogger(
    winston.createLogger({ level, transports, defaultMeta: config?.appName ? { appName: config.appName } : {} }),
  );
}

const _cache = new Map<string, Logger>();

export function getLogger(appName: string, config?: Omit<LogConfig, 'appName'>): Logger {
  if (!_cache.has(appName)) _cache.set(appName, createLogger({ ...config, appName }));
  return _cache.get(appName)!;
}

export const logger = createLogger();
export type { Logger, LogConfig, LogFormat, FileLogConfig } from './types';
