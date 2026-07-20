# Lessons — Stromland Build (2026-07-18/19)

Erkenntnisse aus dem autonomen one-prompt-Lauf, wiederverwendbar für künftige
Daten-Kunst-/Canvas-Projekte.

## Energy-Charts-API (Fraunhofer ISE)

- **`/frequency` braucht `region=DE-Freiburg` + `start`+`end` als Unix-RANGE.**
  `region=DE` → „no content available"; `start` allein → genau EIN Punkt.
  Volle Tagespayload ohne Params: 1,45 MB — serverseitig trimmen ist Pflicht.
- **`/public_power` ohne Range 404t direkt nach Mitternacht** (der neue Berlin-Tag
  hat noch keine Punkte). Proxy muss IMMER `start=Berlin-Mitternacht&end=jetzt`
  senden, mit Grace-Fenster (<45 min nach Mitternacht → Vortag). Der Bug zeigte
  sich NUR, weil der Deploy zufällig um 00:17 Berlin lief — Fixture-Fallback hat
  ihn elegant abgefangen (genau dafür ist er da).
- **`/signal.share` = EE-Anteil an der LAST, nicht an der Erzeugung** — legitim
  >100 % (Beobachtung: 139,7 %). UI/Tests dürfen kein 0–100-Band annehmen.
  `/signal` liefert außerdem ~48 h INKLUSIVE Zukunfts-Forecast — „letzter Wert im
  Array" ist morgen Abend, nicht jetzt. Immer Wert@Zeitstempel picken.
- Upstream drosselt Bursts: Test-Polling nie gegen `/api/*`-Proxys richten
  (jeder Poll = Upstream-Call), sequentiell + Retry-Backoff statt Promise.all-Salve.

## Canvas-2D-Malerei (Meridian-Stil)

- **Radial-Gradient größer als sein fillRect = sichtbare Schnittkante.** Der Rect
  muss den GANZEN Gradient-Radius umfassen (oder Gradient beidseitig auf Alpha 0
  auslaufen lassen). Klassiker bei „Glut"-Effekten — sah aus wie eine Glasscheibe.
- **Layer-Composite-Cache:** 6 statische Vollbild-Layer pro Frame zeichnen kostet
  auch mit Cache — die 5 unteren in EIN Composite mergen (nur bei Key-Wechsel neu)
  brachte 14→9 ms/frame (Software).
- CSS-Filter (brightness/saturate) pro Frame setzen = Style-Recalc-Kosten;
  quantisieren (0,0025-Schritte) und nur bei Änderung schreiben.
- **fps ehrlich messen:** Headless-Playwright = SwiftShader (Software, pessimistisch);
  headed-Fenster wird bei Verdeckung auf 1 fps gedrosselt (macOS rAF-Throttling)!
  Lösung: `--headless=new --use-angle=metal` → echte GPU im Headless (M1: 60 fps).
- Per-Pixel-Himmel (Gradient + IGN-Dither) auf halber Auflösung rendern und
  hochskalieren — Dither wirkt trotzdem gegen Banding, Kosten vierteln sich.
- Sonnen-/Preis-Glut als flache **Ellipse** (`ctx.scale(1, 0.22)`) statt Kreis —
  Licht „liegt" auf dem Horizont statt als Ball darüber zu schweben.

## Autonome Qualitätsschleife

- Screenshot→Selbstkritik→Fix in Runden mit BENANNTEN Schwächen (Liste!) schlägt
  diffuses „polieren". Debug-Query-Param (`?dbg=nofog,noprice,…`) zum Layer-Bisect
  war der schnellste Weg, ein „Geisterband" auf die Preis-Glut zurückzuführen.
- Python rundet half-even, JS `Intl` half-up — HUD-Wert-Vergleiche in Tests
  brauchen `ROUND_HALF_UP`, sonst Phantom-Fails bei x,5.
- Deterministische Params (`?mock=1&at=HH:MM&seed=N`) von Anfang an einbauen —
  jede Gate-Suite, jedes OG-Bild, jeder Capture-Shot hängt daran.

## Fresh-Eyes-Fix-Iteration (19.07.)

- **Der Reviewer benennt das Symptom, nicht die Ursache.** „Offshore-Glitzerstreifen
  über den Hügeln" war in Wahrheit der Talboden-Grundton (18 % Amber → Khaki-Band
  ab exakt hor−1). Layer-Bisect (`?dbg=`) schloss die Dynamik aus, **Pixel-Forensik
  (Zeilen-Mittelwerte, Sprung-Detektion)** fand die Kante + Farbe → Ursache in 2 Minuten.
- **Strichdichte muss auflösungs-normiert sein**: fixe Stroke-Counts/Längen, die auf
  1280 px dicht wirken, zerfallen auf 1440+/dpr2 zu Grieß. Dichte pro FLÄCHE skalieren
  (Cap ~2,2×), Länge/Breite pro Bildbreite — und Repaint-Takt gegensteuern
  (Palette-Key gröber quantisieren, coarse-Modus zeichnet 0,45×).
- **Film-Grain: 1,5 CSS-px Kornzelle, dpr-normiert, Opacity ≤ 0,05.** 3-px-Zellen auf
  dpr-1 lesen als TV-Static und fressen jede Strichlage. Und: WebGL-Overlay-Canvas
  (mix-blend-mode WIE drawImage-Composite) erzeugt ohne Hardware-GL „GPU stall due to
  ReadPixels" — vorgerenderte 2D-IGN-Kacheln + `globalCompositeOperation:'overlay'`
  können dasselbe stallfrei auf jeder Plattform.
- **OG-Bilder von malerischem Content als JPEG**: PNG mit Korn = 953 KB, JPEG q85 = 64 KB.
- **Ellipsen-Glut statt Radial+fillRect am Horizont**: Rect-Kante durchs Gradient-
  Zentrum ist dieselbe Falle wie beim Preis-Glut-Bug — Zentrum UNTER die Kante legen
  und drüber ausbluten lassen.
- `/public_power`-404 direkt nach Mitternacht ist NICHT mit einem festen Grace-Fenster
  lösbar (Beobachtung: 00:52 noch leer) — auf 404 einmal mit Vortags-Mitternacht retrien.

## Lebendigkeits-Runde (20.07.)

- **Standbild-QA beweist keine Lebendigkeit.** Alle Gates bewerteten einzelne
  Frames — der User sah 20 Sekunden. Ein „lebendes Gemälde" braucht ein
  MOTION-Gate: 2 Frames im Abstand von Sekunden, Pixel-Delta pro Region über
  kalibrierter Schwelle. Das Vorher riss 3 von 6 Schwellen — messbar genau das,
  was der User „langweilig" nannte.
- **Motion messen heißt Störer ausschalten:** animiertes Korn flutet jede
  Delta-Metrik (→ `?grain=0`), das adaptive Qualitäts-Budget repainted Statik
  zwischen den Frames (→ `?q=1`-Pin), und CSS-`brightness()` arbeitet in
  **linearRGB** — im sRGB-Screenshot per Gain-Match nicht kürzbar (→ `?filter=0`).
  Erst mit allen drei Schaltern fällt der Rausch-Floor auf ~0,003–0,08 und die
  Schwellen werden trennscharf. Solche Mess-Schalter gehören als Query-Params in
  die App (Prod-Verhalten identisch), nicht als Test-Hacks in die Suite.
- **Bewegung, die man in 5 s spüren soll, braucht Perioden in Sekunden.**
  Nebel-Drift 4–10 px/s liest als Standbild; 15–40 px/s in drei Tempi liest als
  Wetter. Dasselbe Prinzip überall: Glitzerpunkte mit 1–2-s-Leben, Funkeln mit
  0,7–2,5 Hz, Warnlicht-Blitz mit 3-s-Periode.
- **Intro als Replay-Variante, nicht als Neubau:** die vorhandene
  Offset-Mechanik (`replayOffsetMin`) + eine gewichtete Zeitachse (Gauß ums
  Sonnenhorizont-Fenster = verweilen, Nacht = eilen, Ende-Rampe = settle) ergibt
  eine Kino-Fahrt in ~80 Zeilen. Voraussetzung: das Datenfenster muss den Vortag
  enthalten — sonst zeigt „gestern Mittag" keine Sonne (Daten-Lookup wrappt
  notfalls auf denselben Uhrzeit-Punkt des verfügbaren Tages).
- **Abbruch-Klick schlucken:** `pointerdown` (capture) bricht das Intro ab, aber
  der nachfolgende `click` würde die Galerie togglen — ein 800-ms-Schluck-Fenster
  auf dem capture-`click` löst das sauber.
- `/frequency`-Upstream liefert vereinzelt Artefakte außerhalb 49,5–50,5 Hz —
  das echte Netz tut das nie (Lastabwurf ab 49,0). Im Proxy filtern, nicht im
  Client tolerieren.

## Vercel

- `vercel alias set` meldet „no access to domain" für **Projekt-Domains** —
  irrelevant: eine per Projekt-API (`POST /v10/projects/:id/domains`) angehängte
  Domain folgt automatisch jedem neuen Production-Deploy. Inhaltlich verifizieren
  (Marker im neuen Code), nicht auf den CLI-Befehl bestehen.
- CLI-Token liegt in `~/Library/Application Support/com.vercel.cli/auth.json` —
  reicht für die Projekt-API, kein separates Token nötig.

## Kosten (Ist)

| Posten | Menge | Ist |
|---|---|---|
| Paid-Renders / APIs | 0 | 0,00 € |
| energy-charts.info | frei (CC BY 4.0) | 0,00 € |
| OG-Bild | Playwright-Screenshot | 0,00 € |
| **Gesamt** | | **0,00 €** (Budget 10 €) |
