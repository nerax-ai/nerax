# @nerax-ai/logger

Scoped logger with file rotation support, built on Winston.

## Usage

```ts
// Default logger (console only, no appName)
import { logger } from '@nerax-ai/logger';
logger.info('hello');

// Singleton per app name (recommended)
import { getLogger } from '@nerax-ai/logger';
const log = getLogger('my-app');

log.info('started'); // 12:00:00 info [my-app]: started
log.scope('router').info('request'); // 12:00:00 info [my-app][router]: request
log.scope('router').scope('auth').info('check'); // 12:00:00 info [my-app][router][auth]: check
```

```ts
// Custom config
import { createLogger } from '@nerax-ai/logger';
const log = createLogger({
  appName: 'my-app',
  level: 'debug',
  consoleFormat: 'text',
  files: [
    { filename: 'app-%DATE%.log', level: 'info', format: 'json' },
    { filename: 'error-%DATE%.log', level: 'error' },
  ],
});
```

## Scoped Loggers

`scope()` returns a `Logger` sharing the same transports, with an additional `[name]` bracket prepended. Scopes are nestable:

```ts
const log = getLogger('my-app');
const routerLog = log.scope('router');

routerLog.info('start'); // [my-app][router]: start
routerLog.scope('auth').info('check'); // [my-app][router][auth]: check
```

Scoped loggers implement the same `Logger` interface and can be passed anywhere a `Logger` is expected.

## With Storage

`appName` automatically resolves the log directory from `@nerax-ai/storage` (`~/.local/state/<appName>`):

```ts
const log = createLogger({
  appName: 'my-app',
  files: [{ filename: 'app-%DATE%.log', level: 'info' }],
  // baseDir defaults to getStorage('my-app').state.path
});
```

Or set `baseDir` explicitly to override:

```ts
const log = createLogger({
  baseDir: '/var/log/my-app',
  files: [{ filename: 'app-%DATE%.log', level: 'info' }],
});
```

## Config

| Option          | Type               | Default  | Description                                             |
| --------------- | ------------------ | -------- | ------------------------------------------------------- |
| `appName`       | `string`           | —        | App name; used as log tag and default `baseDir`         |
| `level`         | `string`           | `'info'` | Minimum log level                                       |
| `console`       | `boolean`          | `true`   | Enable console output                                   |
| `consoleFormat` | `'text' \| 'json'` | `'text'` | Console output format                                   |
| `baseDir`       | `string`           | —        | Base directory for log files (overrides `appName` path) |
| `files`         | `FileLogConfig[]`  | `[]`     | File transports                                         |

Each `FileLogConfig`: `{ filename, level, format?, maxSize?, maxFiles? }` — supports `%DATE%` in filename for daily rotation.
