# ArtiSys EventBus web snapshot

This directory contains the browser/PWA subset consumed by Gestão de Amamentação.

- Source repository: `nutricionistaalmeidavh-spec/utilidades`
- Module: `modules/artisys-eventbus`
- Version: `0.2.0`
- Reviewed source commit: `1c8d00810dcaa9010330ce7adc2877c90484d17d`
- Imported files: `web/domain-event.mjs`, `web/event-bus.mjs`, `web/adapters/broadcast-channel.mjs`

The files are kept byte-for-byte equivalent to the reviewed source revision. D1 and SSE adapters are intentionally not consumed in this first integration because Supabase/Postgres remains the clinical source of truth and cross-device server delivery is out of scope.
