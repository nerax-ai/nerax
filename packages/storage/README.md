# @nerax-ai/storage

XDG Base Directory compliant file storage for Node.js applications.

## Install

```ts
import { getStorage, createStorage } from '@nerax-ai/storage';
```

## Usage

```ts
// Singleton per app name (recommended)
const storage = getStorage('my-app');

// Or create a new instance
const storage = createStorage('my-app');
```

## Directories

| Property         | XDG Variable      | Default Path           |
| ---------------- | ----------------- | ---------------------- |
| `storage.data`   | `XDG_DATA_HOME`   | `~/.local/share/<app>` |
| `storage.config` | `XDG_CONFIG_HOME` | `~/.config/<app>`      |
| `storage.cache`  | `XDG_CACHE_HOME`  | `~/.cache/<app>`       |
| `storage.state`  | `XDG_STATE_HOME`  | `~/.local/state/<app>` |

## API

Each directory exposes:

```ts
storage.config.path; // absolute path string
storage.config.read('file.txt'); // Promise<string | undefined>
storage.config.write('file.txt', 'content'); // Promise<void>
storage.config.readJSON<T>('data.json'); // Promise<T | undefined>
storage.config.writeJSON('data.json', obj); // Promise<void>
storage.config.delete('file.txt'); // Promise<void>
```

Directories and parent paths are created automatically on write.
