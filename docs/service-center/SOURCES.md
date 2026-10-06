# Service Center source registry

## Selective reference: Dashy

- Upstream: [Lissy93/dashy](https://github.com/Lissy93/dashy), commit [`988b466dd585131096ae990aab4eb98175c5bd16`](https://github.com/Lissy93/dashy/tree/988b466dd585131096ae990aab4eb98175c5bd16).
- License: [MIT](https://github.com/Lissy93/dashy/blob/988b466dd585131096ae990aab4eb98175c5bd16/LICENSE), copyright © 2019–2026 Alicia Sykes.
- Inspected at that pinned commit: [`docs/configuring.md`](https://github.com/Lissy93/dashy/blob/988b466dd585131096ae990aab4eb98175c5bd16/docs/configuring.md), which describes human-friendly visual editing plus JSON/file import/export; and [`src/utils/config/ConfigSchema.json`](https://github.com/Lissy93/dashy/blob/988b466dd585131096ae990aab4eb98175c5bd16/src/utils/config/ConfigSchema.json), which describes organized service items and schema validation.
- Adopted concepts only: a browsable set of service links, a human editor, portable validated config. No Dashy source file, function, schema text, component, artwork or dependency was copied. The Studio JSON contract, validation, persistence, permission policy, health policy and Vue UI were written separately for this repository.
- Deliberately not imported: Dashy Express app, auth, themes, YAML watcher, widgets, arbitrary icons/favicon fetching, HTTP proxy or external-dashboard shell. This feature keeps Studio's own native routing, theme, authentication and state ownership.

If any source is copied in a future change, record the exact pinned file, copied symbols, changes and original MIT notice here before committing it.
