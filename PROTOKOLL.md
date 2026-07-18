# PROTOKOLL — Stromland Build-Lauf

> Autonome Build-Session (one-prompt-kit · op-build) · Start 2026-07-18 ~23:00
> Konzept: `agent-studio/.planning/one-prompt/stromland/CONCEPT.md` (eingefroren)
> Arbeitsordner: `~/Desktop/APPS/stromland/` · Ziel: stromland.demo.osai.solutions

## Status

| Phase | Gate | Status |
|---|---|---|
| 1 Fundament (Proxy + Datenmodell + Fixture) | 3×/api/* valide + Ausfall→Fixture, Suite 2× | ✅ PASS (2× grün) |
| 2 MVP-Gemälde (11 Mappings + Paletten) | 4-Tageszeiten-Shots + HUD==API | ✅ PASS (2× grün) |
| 3 Features (Replay/Galerie/Overlay/OG) | Suite 2× inkl. Replay + Mobile | ✅ PASS (2× grün) |
| 4 Polish (Sensations-Schleife) | ≥3 Kritik-Runden + 60fps + Wand-Urteil | ✅ PASS (3 Runden, 60fps GPU, Urteil: JA) |
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

- 2026-07-19 00:xx — **Phase 2 PASS.** Malerei-Engine komplett: 6 gecachte Layer (Sky-Dither/Celestial/Far/Mid/River/Fore) + Dynamik (Partikel-Flow-Field, Nebel, Fluss-Schimmer, Offshore-Flicker, Preis-Glut, Klarheits-Schleier, Atmen). Alle 11 Mappings implementiert. Gate-Suite `tests/suite-visual.py` 2× grün (HUD==API exakt, 0 Konsolen-Fehler, 6/6 Stimmungs-Paare Δ>12).
  - Gefixte Maler-Bugs: Sky-Stops unsortiert (`0.78*horF/0.65`) · fehlender Talboden (Himmel schien durch → weißes Band) · Radial-Gradient größer als fillRect → sichtbare Schnittkante (Preis-Glut) · Schleier-Rect über Gradient-Ende hinaus · Fog-Farbe bei Dusk orange · Partikel-Respawn-Häufung links · Talboden nutzte Akzent-Stops (Neon-Balken bei Dusk).
  - Test-Lektion: Python rundet half-even, JS Intl half-up — HUD-Vergleiche brauchen ROUND_HALF_UP.

- 2026-07-19 00:xx — **Phase 3 PASS.** Replay „Dieser Tag" (40 s, eased, Coarse-Layer-Modus), Galerie-Modus (Tap/g), Info-Overlay (poetische Legende, 10 Ebenen erklärt, Attribution, Impressum/Datenschutz verlinkt), Legal-Seiten mit echten Stammdaten, OG-Bild via Playwright (21:15 golden hour, 0 €), vollständige OG/Twitter-Meta + SVG-Favicon. `tests/suite-features.py` 2× grün + `suite-visual.py` Regression 2× grün.
  - Polish-Kandidaten (aus Mobile-Shot): Preis-Glut zu boxig (Ellipse statt Kreis nötig), Vegetations-Striche bei Dusk zu gelb (light-Param nutzt Amber), HUD-Werte-Zeile bricht auf 390px um.

- 2026-07-19 01:xx — **Phase 4 PASS.** 3 Kritik-Runden dokumentiert:
  - R1: Preis-Glut Kreis→flache Ellipse + Fluss-Lichtpfad · Sonnen-Kern strukturiert · Gegenlicht-Sheen im Fluss bei tiefer Sonne · HUD-Kurzform mobil (EE statt Erneuerbare).
  - R2: Vegetations-Formel war rückwärts (Amber-Speckles bei Dusk) → Tag grün/Nacht Silhouette · Tal+Schleier+Mittelkämme bei Dämmerung/Nacht abgedunkelt (Land = Silhouette vor Glut-Himmel) · Dämmerungs-Glut im Himmel verstärkt.
  - R3: Glut kompakter (r 0.30→0.20w, Kern ×1.5) · Nebelband 1 dezenter · Turbinen-Kontrast · Tages-Vegetation präsenter · **Perf: 5 Statik-Layer → 1 Composite (14→9 ms/frame Software)** · CSS-Filter quantisiert · Grain auf 1/3-Auflösung.
  - **fps-Gate:** 60,0 fps @ q=1 auf echter GPU (Apple M1, ANGLE Metal, headless `--use-angle=metal`) · Mobile-Viewport 60 fps · Software-Fallback (SwiftShader) 47–49 fps mit adaptivem Budget (q→0.85). 
  - **Wand-Urteil: JA.** Begründung: Dusk (21:30) und Nacht (01:00) sind eigenständige Bilder — Amber-Glut am Horizont, der Fluss als rosa Lichtader, Mond mit Hof über stiller Strata-Landschaft; ich würde beide als Print aufhängen. Dawn (05:30) ist ein stilles Silhouetten-Bild mit Türkis-Himmel. Der Tag (13:00) ist bewusst nordisch-dunstig — das schwächste Einzelbild, aber als Teil des lebenden Zyklus stimmig (und ehrlich: 45 GW Solar = gleißender Dunst-Himmel). Alle 4 Regression-Suiten grün.

## TODOs / Offenes

- (leer)
