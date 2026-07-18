# PROTOKOLL — Stromland Build-Lauf

> Autonome Build-Session (one-prompt-kit · op-build) · Start 2026-07-18 ~23:00
> Konzept: `agent-studio/.planning/one-prompt/stromland/CONCEPT.md` (eingefroren)
> Arbeitsordner: `~/Desktop/APPS/stromland/` · Ziel: stromland.demo.osai.solutions

## Status

| Phase | Gate | Status |
|---|---|---|
| 1 Fundament (Proxy + Datenmodell + Fixture) | 3×/api/* valide + Ausfall→Fixture, Suite 2× | ✅ PASS (2× grün) |
| 2 MVP-Gemälde (11 Mappings + Paletten) | 4-Tageszeiten-Shots + HUD==API | — |
| 3 Features (Replay/Galerie/Overlay/OG) | Suite 2× inkl. Replay + Mobile | — |
| 4 Polish (Sensations-Schleife) | ≥3 Kritik-Runden + 60fps + Wand-Urteil | — |
| 5 Ship (Deploy + Legal) | E2E live + alias + inhaltl. Live-Check | — |
| 6 Excellence-Pass | 10 Schwächen, Top-5-Fix, Suite 2× | — |

## Upstream-Verifikation (2026-07-18, live gemessen)

- `GET /public_power?country=de` → `{unix_seconds, production_types[{name,data}], deprecated}`, 21 Typen, 15-min-Raster. Enthält auch „Renewable share of generation".
- `GET /frequency` — **Abweichung vom Konzept-Wortlaut:** Der `start`-Param allein liefert nur EINEN Punkt. Korrekt ist `region=DE-Freiburg` (Default-Region, `region=DE` → „no content available") **plus `start`+`end` als Unix-Range** → 1-s-Daten, ~20 KB/20 min, letzter Punkt ~2 min hinter Echtzeit. Ohne Params: 1,45 MB Tagespayload (Konzept-Angabe bestätigt). Proxy sendet daher immer start+end.
- `GET /signal?country=de` → `{unix_seconds, share, signal, substitute}` (kein start/end — nur aktuelles Fenster).
- `GET /price?bzn=DE-LU` → `{unix_seconds, price, unit:"EUR / MWh", license_info}`, akzeptiert start/end.

## Entscheidungen (dokumentierte Abweichungen/Präzisierungen)

1. **Proxy reshaped serverseitig** (statt Roh-Passthrough): `/api/power` liefert benannte Serien
   (solar, wind_onshore, wind_offshore, biomass, hydro, pumped_gen, pumped_consumption, fossil, load, re_share)
   — kleinerer Payload, Client-Code identisch für live & Fixture. Konzept nennt nur Route+Cache, kein Format-Verbot.
2. **Fixture-Share** wird aus der `public_power`-Serie „Renewable share of generation" gezogen
   (Signal-Endpoint kann keine Vergangenheit). Live läuft Share weiterhin über `/signal` via `/api/context`.
3. **Frequenz-Fixture:** 30-min-Echtfenster, Client loopt es nahtlos (Puffer-Prinzip wie live).
4. Fixture-Daten liegen doppelt: `public/fixtures/day.json` (Client) + `api/_lib/fixture-data.js`
   (Serverless-Fallback als ESM-Modul — kein JSON-Import-Assert-Risiko, keine FS-Pfad-Fragen auf Vercel).

## Lauf-Log

- 2026-07-18 23:0x — Konzept + op-build-SKILL + pixel-runner-LESSONS + app.md-Rezept + STAMMDATEN gelesen. Repo initialisiert. Alle 4 Upstreams live verprobt (Strukturen oben).
- 2026-07-18 23:2x — **Phase 1 PASS.** Fixture = Echt-Tag 2026-07-17 (97 Power-Punkte, 97 Preis-Punkte, 1801 Freq-Samples, 43 KB). Proxy-Handler power/frequency/context mit Allowlist, 8-s-Timeout, Last-Good-Cache, Fixture-Fallback. Suite `tests/suite-api.mjs` 2× grün (Live-Pass + Offline-Pass).
  - Fachbefund: `/signal.share` = EE-Anteil **an der Last** — überschreitet legitim 100 % (heute max 139,7 %). Test-Band auf 0–250 korrigiert; Info-Overlay muss das später erklären.
  - Flake-Ursachen behoben: waitUp pollte /api/* (Upstream-Hammering) → pollt jetzt Statik; Live-Checks sequentiell + 1 Retry (Upstream drosselt Bursts).

## TODOs / Offenes

- (leer)
