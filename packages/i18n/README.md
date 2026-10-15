# @makerkit/i18n

Lets coding agents read and edit JSON translation files: list every key in every locale, set a value, check how much of each locale is translated, and add or remove locales and namespaces.

It works with projects that keep one folder per locale and one JSON file per namespace:

```
public/locales/
  en/
    common.json
    auth.json
  de/
    common.json
    auth.json
```

This is the layout used by i18next and next-i18next, and by next-intl projects that split messages into namespace files. A single file per locale (`messages/en.json`) is not supported.

Nested JSON objects are read as dot-separated keys: `{ "header": { "title": "Home" } }` is the key `header.title`.

## Tools

| Tool | What it does |
|---|---|
| `translations_list` | Every locale, namespace and key with its value; `base_locale` is the reference locale |
| `translations_update` | Sets one key in one locale and namespace; missing parent groups are created |
| `translations_stats` | Per-locale count of translated and missing keys, compared with the base locale |
| `translations_add_namespace` | Creates an empty namespace file in every locale |
| `translations_add_locale` | Creates a locale folder with an empty file for every existing namespace |
| `translations_remove_namespace` | Deletes a namespace file from every locale |
| `translations_remove_locale` | Deletes a locale folder and its files (the base locale cannot be removed) |

Locale and namespace names that contain path separators or `..` are rejected, so the tools only touch files inside the messages directory. Keys such as `__proto__` are rejected too.

## Use from code

```ts
import { createTranslationsService } from '@makerkit/i18n';
import { createI18nDeps } from '@makerkit/i18n/node';

const translations = createTranslationsService(createI18nDeps(process.cwd()));

const { coverage } = await translations.stats();

await translations.update({
  locale: 'de',
  namespace: 'common',
  key: 'header.title',
  value: 'Startseite',
});
```

### Settings

```ts
createI18nDeps(root, {
  settings: {
    messagesDir: 'apps/web/i18n/messages', // default: public/locales
    baseLocale: 'en', // default: the first locale alphabetically
    indent: 2, // default
  },
});
```

- `messagesDir`: the folder that contains the locale folders. Absolute, or relative to the root path.
- `baseLocale`: the locale that coverage is measured against and that `translations_remove_locale` refuses to delete. When it is not set, or that folder does not exist, the first locale in alphabetical order is used.
- `indent`: indentation for written files. Files are written as JSON with a trailing newline.

## Add the tools to an MCP server

Requires `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTranslationsService } from '@makerkit/i18n';
import { registerI18nTools } from '@makerkit/i18n/mcp';
import { createI18nDeps } from '@makerkit/i18n/node';

const server = new McpServer({ name: 'i18n', version: '1.0.0' });

registerI18nTools(
  server,
  createTranslationsService(createI18nDeps(process.cwd())),
);
```

Pass `{ prefix: 'my_' }` as a third argument to prefix the tool names.

## License

MIT
