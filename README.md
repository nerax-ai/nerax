# nerax-ai

Core infrastructure packages for building extensible AI applications.

## Packages

| Package                                   | Description                      |
| ----------------------------------------- | -------------------------------- |
| [`@nerax-ai/storage`](./packages/storage) | XDG-compliant file storage       |
| [`@nerax-ai/logger`](./packages/logger)   | Scoped logger with file rotation |
| [`@nerax-ai/plugin`](./packages/plugin)   | Type-safe plugin registry        |

## Development

```sh
bun install
bun run build   # build all packages
bun run test    # build then test
bun run lint    # type-check all packages
```
