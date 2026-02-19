export type LogFormat = 'text' | 'json';

export interface FileLogConfig {
  level: string;
  filename: string;
  format?: LogFormat;
  maxSize?: string;
  maxFiles?: string;
}

export interface LogConfig {
  level?: string;
  console?: boolean;
  consoleFormat?: LogFormat;
  appName?: string;
  baseDir?: string;
  files?: FileLogConfig[];
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  scope(name: string): Logger;
}
