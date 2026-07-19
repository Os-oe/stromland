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
| 5 Ship (Deploy + Legal) | E2E live + alias + inhaltl. Live-Check | ✅ PASS (Live-Check + 2 E2E-Suiten grün) |
| 6 Excellence-Pass | 10 Schwächen, Top-5-Fix, Suite 2× | ✅ PASS (Live-Suiten 2× grün nach Re-Deploy) |

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

- 2026-07-19 00:3x — **Phase 5 PASS (SHIP).** GitHub `Os-oe/stromland` (public) · Vercel `os-oes-projects/stromland` · `vercel git connect` · Domain via Projekt-API angehängt (HTTP 200, verified) → **https://stromland.demo.osai.solutions** live.
  - **Prod-Bugfix (Echtwelt-Edge-Case):** Deploy um 00:17 Berlin → `/public_power` ohne Range = „heute" = leerer Tag = Upstream-404 → Fixture-Fallback griff (korrekt!), aber live ist besser: Proxy fragt jetzt IMMER explizit `start=Berlin-Mitternacht&end=jetzt`; < 45 min nach Mitternacht → Vortags-Mitternacht (Replay bleibt sinnvoll).
  - **CLI-Quirk:** `vercel alias set` meldet „no access to domain" für Projekt-Domains — funktional irrelevant: Projekt-Domain folgt automatisch dem neuesten Production-Deploy (verifiziert: `source=live` via Domain, das kann nur der neue Code). In LESSONS.
  - Gates: `live-check.py` GRÜN (HUD == Live-API: EE 55 %, Wind 16,7 GW, Solar 0,0 GW @ 00:30 ✓, 49,991 Hz; Impressum+Datenschutz+og.png live; 0 Konsolen-Fehler) · `suite-visual.py` gegen Live GRÜN · `suite-features.py` gegen Live GRÜN.
  - Test-Lektion #2: `/signal` liefert 48h inkl. Zukunfts-Forecast — „letzter Wert" ist morgen; Vergleiche brauchen Wert@jetzt.

- 2026-07-19 00:5x — **Phase 6 PASS (Excellence).** 10 Schwächen gesucht:
  1. Erstbesuch nachts ohne Kontext → ✅ einmaliger Hint (localStorage, nur natürlicher Modus)
  2. Replay ohne Fortschrittsanzeige → ✅ Hairline am unteren Rand
  3. Kein prefers-reduced-motion → ✅ Atmen aus, Budget halbiert (QMAX 0.5)
  4. Kein noscript-Fallback → ✅ poetische Meldung + Attribution
  5. Netz-Atmen kaum spürbar (Kern-Mapping!) → ✅ Amplitude verstärkt (0.011–0.055 statt 0.008–0.04)
  6. Tag-Zenit blass → ✅ Zenit-Stop hält bis 14 % der Horizonthöhe
  7. Fluss endet am Vordergrund-Stratum hart → akzeptiert (liest sich als „hinterm Hügel")
  8. Galerie-Modus schwer entdeckbar → teilgefixt (Hint nennt ihn)
  9. Turbinen-Blade-Aliasing bei Minigrößen → offen (minor)
  10. OG-Bild zeigt Fixture-Dusk statt Live → by design (konstanter goldene-Stunde-Hook)
  Re-Deploy via git push (Auto-Deploy über git connect). Finale Verifikation: live-check GRÜN + Visual-Suite 2× GRÜN + Features-Suite 2× GRÜN gegen https://stromland.demo.osai.solutions.

## Fresh-Eyes-Fix-Iteration (2026-07-19, externe Review-Session)

13 Findings (P1 1–4 kritisch, P2 5–9, P3 10–13) + 1 Bonus-Bug beim Baseline-Lauf. Alle umgesetzt:

| # | Finding | Fix | Commit |
|---|---|---|---|
| — | Baseline rot: `/api/power` 404 um 00:52 (jenseits 45-min-Grace) | Vortags-Retry statt Zeitraterei | 190fbd2 |
| 1 | „Offshore-Schimmerband" als messerscharfer Streifen | Echte Ursache per Pixel-Forensik: **Khaki-Talboden** (18 % Amber in valleyTop) + Becken-Rect-Kante bei hor. Distanz-Haze + Ellipsen-Becken + Kammbasen-Dunst; Glitzer auf seaClip geclippt | adf2b71 |
| 2 | Mittag = fahle Milchsuppe statt 45-GW-Triumph | Zenit-Sättigung aus Solar×Klarheit, Gold-Wash, größere Glut, Godrays radial, Mittagslicht-Wash überm Land | 92aec10 |
| 3 | Grain = TV-Static | Reines 2D-IGN-Korn, 1,5 CSS-px dpr-normiert, Opacity 0.10→0.05 | 5081cb5 |
| 4 | Strichlagen-Dichte fehlt (1440px) | strokeFill auflösungs-normiert (Dichte/Fläche, Länge/Breite), Kontur-Striche, 2-seitiger Ton-Jitter, Strata-Bänder | ef55313 |
| 5 | Totes Mittelband, harte Stufenkante | Wertetrennung hinten hell/kühl, Dunst ZWISCHEN Kämmen, dk-Gradient bis Bildrand | adf2b71 + ef55313 |
| 6 | Windräder haarfein, Partikel zu leise | Größenvarianz + 2 Boost-Räder, dickere Masten/Blätter + Gondel, Partikel-Alpha rauf | 92aec10 |
| 7 | Fluss nachts = dunkler Riss | Mondlicht-Glint (Silber-Sheen) + hellere Nacht-Himmelsspiegelung | 92aec10 |
| 8 | Mobile-Intro bricht hässlich um | Eigene Kurzzeilen-Fassung < 520 px | 10328c8 |
| 9 | Mond: Augen-Krater + Banding-Ring | Mare fast unsichtbar, Halo mit geeasten Stops | 92aec10 |
| 10 | 4× „GPU stall due to ReadPixels" | Finish-Pass ganz ohne WebGL/mix-blend-mode → Konsole clean | 5081cb5 |
| 11 | og.png 953 KB | og.jpg q85 = 64 KB (render-og, Metas, live-check umgestellt) | 10328c8 |
| 12 | Tap-Ziele < 44 px | actions/overlay-close Padding ≥ 44 px, Optik bleibt Hairline | 10328c8 |
| 13 | Galerie-Modus = Falle | Exit-Hint einmal pro Sitzung | 10328c8 |

Perf nach Iteration: 60,0 fps GPU (Metal, 1600×1000, q=1) · Software 45,5 fps (q=1, über der 42er-Absenkschwelle).
Vergleichs-Shots: `shots/iter2/` (Desktop 4 Tageszeiten + Mobile 21:15).

**Verifikation (19.07., nach Re-Deploy e147087):** lokal alle 3 Suiten 2× GRÜN ·
live-check GRÜN (HUD == echter Strommix, Legal, og.jpg 64 KB, 0 Konsolen-Fehler) ·
suite-visual 2× GRÜN + suite-features 2× GRÜN gegen https://stromland.demo.osai.solutions ·
Domain serviert neuen Code (Marker og.jpg/gallery-hint/fh-mobile verifiziert — kein
`alias set` nötig, Projekt-Domain folgt Prod-Deploy).

**Wand-Urteil nach Fix-Iteration: JA, gefestigt.** Dusk (21:15) und Nacht (01:00) sind
jetzt ohne die Band-Artefakte echte Prints — der Fluss als Lichtader vor weicher
Horizontglut, Mond ohne Banding-Ring über silbern glitzerndem Wasser. Dawn (05:30) ist
ein stilles Türkis-Bild. Der Mittag (13:00) hat den größten Sprung gemacht (sattes
Zenit-Blau, triumphale Sonne, sonnenbeschienenes strukturiertes Land) — ehrlich bleibt
er das schwächste der vier Einzelbilder, aber erstmals eines, das ich zeigen würde,
nicht nur ertragen.

## Mittags-Triumph-Iteration (2026-07-19, Fix-Session)

Ziel: 13:00 (Solar 45,1 GW + EE 78 %) von „milchig" zur Triumph-Stunde — andere
Tageszeiten unverändert. 4 Runden mit Screenshot-Selbstkritik, nur `painter.js`:

1. **Milchband** — `paintSky()`: Triumph-Faktor `tri = wDay·high·solar·(0.35+0.65·clarity)`
   moduliert Stop-Positionen (Blau hält bis ~0.63·horF hinab, Dunstband auf das
   letzte Zehntel gestaucht) und färbt die mittleren Stops warmblau→hellgold
   (`zen1T`/`midSkyT` + Hellgold-Saum-Stop bei 0.962·horF, kontinuierlich aus der
   natürlichen Interpolation — kein Pop an der tri-Schwelle). Klarheits-Schleier
   mittags warm durchleuchtet statt Grauband.
2. **Sonne** — `paintCelestial()`: `coreBoost = high·solar` macht den Kern heller/
   größer/dichter (zusätzlicher Gradient-Stop bei 0.32, startet exakt auf der
   linearen Rampe) + wärmerer innerer Hof — „man blinzelt", keine harte Scheibe.
3. **Land** — `paintMid()`: `noon = wDay·solar·smooth(10,32,sunElev)` hebt
   Talboden-Basiston, Kamm-Töne (vorn stärker als hinten — Luftperspektive) und
   Strichlagen-Highlights goldgrün an ([242,232,158]-Richtung); Sonnen-Wash überm
   Land kräftiger. Basis-PALETTES unangetastet — reine Daten-Modulation.

Gates: alle Faktoren ==0 bei wDay==0 oder high==0 → 05:30/21:15/01:00 pixelidentisch
(MAD vs. iter2-Referenzen 3,0–4,1 bei Run-zu-Run-Rauschen 3,0; 13:00 Δ=12,0 wie
beabsichtigt). `suite-visual.py` 2× GRÜN, `suite-features.py` GRÜN. Shots: `shots/iter3/`.

**Urteil 13:00:** erstmals ein eigenständiges Bild — sattes Blau bis tief hinab,
präsente Blinzel-Sonne, besonntes goldgrünes Land; das Dunstband ist ein schmaler,
warmer Saum. Ehrlich: im Vergleich zu Dusk/Nacht bleibt es das leiseste der vier
Bilder, aber es liest jetzt als Triumph, nicht als Milch.

## Fürs Video (op-capture-Übergabe)

- **Replay „Dieser Tag"** ist das Capture-Gold: `?mock=1&seed=7` + Klick auf „Dieser Tag" → 40-s-Fahrt Sonnenaufgang→Solarflut→Abendglut→Nacht mit Fortschritts-Hairline.
- Einzelmomente: 21:30 Dusk (Amber-Glut + rosa Fluss-Lichtader) · 01:00 Mond+Sterne · 05:30 Türkis-Dämmerung · Galerie-Modus-Toggle (Tap → alles weg) · Info-Overlay-Scroll (poetische Legende) · Live-HUD neben echtem energy-charts-Chart als Beweis-Beat.
- Mobile-Hochformat (390×844) sieht stark aus — 9:16-Material direkt abgreifbar.
- Deterministisch: `?at=`, `?seed=`, `?mock=1` — jede Einstellung reproduzierbar.

## TODOs / Offenes

- **Sales-Board:** CC-Server (localhost:5050) lief beim Abschluss nicht → Lead-Karte + Sprint `one-prompt-kit-stromland` (Demo-Record, stage delivered, URL stromland.demo.osai.solutions, 0,00 €) noch per `POST /api/sales/leads` nachtragen, sobald das Command Center läuft.
- `vercel alias set` CLI-Quirk bei Projekt-Domains (funktional ok — Domain folgt Prod-Deploy automatisch; siehe LESSONS).
- Offene Minor-Schwächen: #7 Fluss/Fore-Kante, #9 Blade-Aliasing.
