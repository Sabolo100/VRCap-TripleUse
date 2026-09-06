# VR CAP — Cognitive Assessment Platform

WebXR alapú kognitív, figyelmi, döntési és pszichomotoros mérőrendszer.
**Egy motor, három terület:** védelmi kiválasztás (A), munkaalkalmasság és
pályaorientáció (B), sportági tehetségazonosítás (C).

Elsődleges célhardver **Meta Quest 3** (WebXR, két kontroller). Ugyanez a build
fut asztali böngészőben egérrel és mobilon érintéssel — az eredményeket a
rendszer külön eszközosztályként kezeli.

---

## Mi működik most

| | |
|---|---|
| **Kezdőtér** | Területválasztás + kezdőtér 2D-ben és VR-ben, opcionális belépéssel, előzménnyel, képességprofillal |
| **01 SIGNAL** | Jellemző- és konjunkciós keresés, többobjektumos követés, változásészlelés, perifériás detekció. Fő mutató a keresési meredekség |
| **03 NAV** | Bejárás, újrajárás előre/fordítva, iránybecslés (JRD), útvonal-integráció, térkép–terep megfeleltetés |
| **04 REACT** | Egyszerű és választásos reakció, célra mutatás, folyamatos követés, kétkezes koordináció |
| **06 WATCH** | Teljes 360°-os emitterrács; térbeli lefedettség, hátsó detekció, mélységi költség, éberség-lejtés |
| **07 PRESSURE** | Alapvonal, interferencia, feladatváltás, nyomás, helyreállás — a „choking" mérhető magja |
| **08 HOLD** | Feléd repülő testek: go/no-go, stop-jel SSRT-lépcsővel, pályaítélet mélységből, szabályváltás |
| **09 MEMORY** | 3D Corsi térfogatban, térbeli frissítés rejtett forgatással, tárgy-hely kötés, térbeli 2-back |
| **10 COMMAND** | 2–5 fős csapatfeladat rejtett információval, két körrel, AI csapattársakkal, opcionális hanggal |
| **11 ANTICIPATE** | Koincidencia-időzítés időbeli takarással; konstans, variábilis és abszolút hiba |
| **12 FIELD** | Hasznos látómező 50°-ig, adaptív küszöbbel, mélységi alteszttel és fejpózból ellenőrzött fixációval; közeledő célon mért dinamikus látásélesség |
| **13 STEADY** | Poszturográfia a headset 6DoF adatából: Romberg, mozgó szoba, egy lábon állás, kéztremor — **csak VR** |
| **14 RHYTHM** | Szinkronizációs-folytatásos kopogás; a térben mozgó ütemjelzés előnye a villanáshoz képest, mélységi és perifériás pályán |
| **15 ADAPT** | Rejtett 30°-os vizuomotoros rotáció: tanulási ráta, utóhatás, savings, és elevációs általánosítás |
| **05 MULTI** | Négy egyidejű MATB-II állomás; VR-ben körülvevő elrendezésben, ahol a figyelemelosztás mérhető fejfordítás lesz |
| **16 HANDS** | Pegboard, kulcsos behelyezés, drótpálya és összeszerelés a karnyújtásnyi térben — **csak VR** |
| **17 RISK** | BART és Iowa; a tét egyszer szögméretben nő, egyszer közeledik állandó szögméret mellett |
| **18 PROTOCOL** | Tíz lépéses eljárás megszakítással, időnyomással és menet közbeni módosítással; a helyreállás két összetevőre bontva |
| **19 INTENT** | Procedurális pontfény-alak időbeli takarással; a fő mutató nem sebesség, hanem időpont |
| **02 SPACE** | Külső modulként bekötve (Shepard–Metzler) |
| **Katalógus** | 19 modul, mind implementálva, területenkénti relevanciával |
| **Backend** | Fastify API + PostgreSQL, eseményszintű naplózással, CSV/JSON exporttal |

**Indítható most: mind a 19 modul** — SIGNAL, SPACE, NAV, REACT, MULTI,
WATCH, PRESSURE, HOLD, MEMORY, COMMAND, ANTICIPATE, FIELD, STEADY, RHYTHM,
ADAPT, HANDS, RISK, PROTOCOL, INTENT. A relevancia-jelölés mutatja, melyik
elsődleges az adott területen.

**Két modul csak VR-ben fut**, és ez nem mulasztás: a STEADY minden mutatója
a headset 6DoF követéséből származik, a HANDS-é a kéz valódi térbeli
mozgásából. Egérrel vagy ujjal ugyanazok a feladatok más képességet
mérnének, ezért nem kínálunk belőlük leromlott változatot — a modulkártya
letiltva, indoklással jelenik meg.

### A térbeliség kihasználása

A modulok nem sík teszteket vetítenek térbeli falra. Hat térbeli eszköz van
használatban, mindegyikhez tartozó méréssel: **körülvevő elrendezés**
(a fejfordítás maga a feladat — WATCH), **mélység önálló csatornaként**
(a szögméret állandó, a távolságot csak a diszparitás hordozza — WATCH, MEMORY),
**közeledés és pálya** (a határidő fizikai — HOLD), **peripersonalis tér**
(karnyújtásnyi mozgás — REACT-B), **forgás és szilárd testek**, valamint
**rejtett transzformáció és nézőpont** (MEMORY frissítése, COMMAND-B ülésrendje).

A próba egyszerű: **változna-e bármelyik metrika, ha az egész jelenetet a
résztvevő elé, egyetlen héjra laposítanánk?** Ha nem, az nem térbeli modul.
Ha egy mérés a térbeliségből származik, sík platformon **hiányzik**, nem
közelítjük. A teljes doktrína: [`docs/03-SPATIAL-DESIGN.md`](docs/03-SPATIAL-DESIGN.md).

### A és B változatok

Öt modul megbukott a laposítási teszten — érvényes tesztek, de bármelyik
monitoron ugyanazt mérnék. Mindegyik kapott egy **B változatot**: ugyanaz a
konstruktum, ugyanaz a szakmai alap, de olyan paradigmában, ami a harmadik
dimenziót ténylegesen méri. Az A változat megmarad; a modulkártya alján
**A / B gomb** választ.

| Modul | B változat | Amit csak a B tud megmérni |
|---|---|---|
| **SIGNAL** | térfogati keresés | használja-e a mélységet keresési szűrőként; mennyibe kerül a hátrafordulás |
| **REACT** *(B: csak VR)* | nyúlás és elfogás | 3D Fitts-meredekség, mélységi vs. oldalirányú követési hiba |
| **PRESSURE** *(B: csak VR)* | térbeli interferencia | mélységi Simon-hatás, figyelmi szűkülés 20/40/60°-on |
| **COMMAND** | szerkezetleltár | mennyivel ér többet a csapat, mint a legjobb helyen ülő tagja egyedül |
| **ANTICIPATE** | ütközésig hátralévő idő | tau alapján időzít, vagy méret-heurisztikával |

A NAV, WATCH, HOLD és MEMORY már eleve térbeli — nekik nincs B változatuk.
A két változat `config_version`-je különbözik, ezért **a normacsoportjaik és a
személyes rekordjaik soha nem keverednek**. Ha egy B változat VR-t igényel,
lapos platformon a gomb letiltva és megindokolva jelenik meg — a rendszer
soha nem indít csendben degradált verziót helyette.

---

## Gyors indítás

```bash
npm install
npm run build -w @vrcap/shared
```

**Fejlesztés** (két terminál):

```bash
npm run dev:server
```

```bash
npm run dev:client
```

A kliens `http://localhost:5173`, az API `http://localhost:8080`. A Vite
dev szerver proxyzza az `/api` és `/ws` útvonalakat.

**Adatbázis nélkül is fut** — a kezdőtér, a modulok és az eredményképernyő
teljesen működik, a futások a böngészőben tárolódnak.

A migrációk indításkor automatikusan lefutnak (`AUTO_MIGRATE=true`). A
változatokat a `003_variants.sql` (`runs.variant`, `config_version` szerint
csoportosított `personal_bests`) és a `004_team_variants.sql`
(`teams.variant`, a COMMAND-B körkimenete és a `team_pooling` nézet) vezeti be.

### Quest 3-on való kipróbálás

A WebXR biztonságos kontextust igényel, tehát a LAN-on HTTPS kell:

```bash
npm run dev:https -w @vrcap/client
```

Ezután a Quest böngészőjéből `https://<gép-IP>:5173` — a self-signed
tanúsítványt egyszer el kell fogadni.

Produkciós build esetén a szerver maga szolgálja ki a klienst:

```bash
npm run build
npm start
```

---

## Adatbázis

```bash
createdb vrcap
DATABASE_URL=postgres://user@localhost:5432/vrcap npm run migrate
```

A migrációk `AUTO_MIGRATE=true` mellett induláskor is lefutnak — ez a
Coolify-telepítés alapértelmezése. A séma:
`packages/server/src/migrations/`.

---

## Telepítés (Coolify + Hetzner)

1. **PostgreSQL** — hozz létre egy managed Postgres szolgáltatást Coolifyban.
2. **Alkalmazás** — új alkalmazás ebből a repóból, build pack: **Dockerfile**.
3. **Környezeti változók** (lásd `.env.example`):

```
DATABASE_URL=postgres://vrcap:<jelszó>@<coolify-belső-hoszt>:5432/vrcap
PGSSLMODE=disable
AUTO_MIGRATE=true
PORT=8080
CORS_ORIGIN=*
STORE_ANONYMOUS_RUNS=true
ADMIN_TOKEN=<hosszú véletlen érték>
```

4. **Domain + TLS** — a Coolify reverse proxyja terminálja a TLS-t. Ez egyben a
   WebXR biztonságos kontextus követelményét is megoldja: **HTTPS nélkül a
   headset nem fog immerzív módba lépni.**
5. **WebSocket** — a COMMAND modulhoz a `/ws` útvonalnak át kell mennie a
   proxyn (Coolify Traefik alapból támogatja).
6. **Healthcheck** — `GET /api/health`.

Önállóan (Coolify nélkül):

```bash
docker compose up -d --build
```

---

## Repó szerkezete

```
packages/
  shared/     Típusok, modulkatalógus, arculatok, scoring, seedelt RNG,
              a COMMAND forgatókönyv-generátor és megoldó, WS protokoll
  client/     WebXR alkalmazás
    engine/     Motor: renderer, XR, input absztrakció, 3D UI, trial-állapotgép,
                naplózás, hang, primitívek, jelrendszer, mozgásrendszer
    shell/      2D DOM felület (területválasztás, kezdőtér)
    hub/        3D kezdőtér
    modules/    SIGNAL (01), NAV (03), REACT (04), MULTI (05), WATCH (06),
                PRESSURE (07), HOLD (08), MEMORY (09), COMMAND (10),
                ANTICIPATE (11), FIELD (12), STEADY (13), RHYTHM (14),
                ADAPT (15), HANDS (16), RISK (17), PROTOCOL (18), INTENT (19)
    modules/shared/  gömbhéj- és térfogat-elrendezés, tárgyválasztás, forgatás,
                testhorgony (BodyAnchor)
    engine/ui/MobileControls.ts  érintéses vezérlőréteg: gomb, tárcsa, csúszka,
                analóg kar, húzásos körbenézés
  server/     Fastify API, PostgreSQL, migrációk, COMMAND szobaszerver botokkal
docs/         Specifikációk (lásd lent)
tests/        Headless tesztek
```

### Dokumentáció

| Fájl | Tartalom |
|---|---|
| [`docs/00-MASTER-SPEC.md`](docs/00-MASTER-SPEC.md) | Master specifikáció: három terület, 19 modul, architektúra, scoring, adatmodell |
| [`docs/01-MODULE-SPEC-PROMPT.md`](docs/01-MODULE-SPEC-PROMPT.md) | Hogyan készül rövid vázlatból teljes modulspecifikáció |
| [`docs/02-CROSSPLATFORM-INTERACTION.md`](docs/02-CROSSPLATFORM-INTERACTION.md) | VR → asztali → mobil leképezés — **kötelező referencia** |
| [`docs/03-SPATIAL-DESIGN.md`](docs/03-SPATIAL-DESIGN.md) | A térbeliség doktrínája: laposítási teszt, hat affordancia, A/B szabályok — **kötelező referencia** |
| [`docs/10-HUB-SPEC.md`](docs/10-HUB-SPEC.md) | A kezdőtér részletes specifikációja |
| [`docs/11-MODULE-04-REACT.md`](docs/11-MODULE-04-REACT.md) | REACT részletes specifikációja **+ B változat** |
| [`docs/12-MODULE-10-COMMAND.md`](docs/12-MODULE-10-COMMAND.md) | COMMAND részletes specifikációja **+ B változat** |
| [`docs/13-MODULE-01-SIGNAL.md`](docs/13-MODULE-01-SIGNAL.md) | SIGNAL részletes specifikációja **+ B változat** |
| [`docs/14-MODULE-03-NAV.md`](docs/14-MODULE-03-NAV.md) | NAV részletes specifikációja |
| [`docs/15-MODULE-07-PRESSURE.md`](docs/15-MODULE-07-PRESSURE.md) | PRESSURE részletes specifikációja **+ B változat** |
| [`docs/16-MODULE-11-ANTICIPATE.md`](docs/16-MODULE-11-ANTICIPATE.md) | ANTICIPATE részletes specifikációja **+ B változat** |
| [`docs/20-MODULE-12-FIELD.md`](docs/20-MODULE-12-FIELD.md) | FIELD részletes specifikációja |
| [`docs/21-MODULE-13-STEADY.md`](docs/21-MODULE-13-STEADY.md) | STEADY részletes specifikációja |
| [`docs/22-MODULE-14-RHYTHM.md`](docs/22-MODULE-14-RHYTHM.md) | RHYTHM részletes specifikációja |
| [`docs/23-MODULE-15-ADAPT.md`](docs/23-MODULE-15-ADAPT.md) | ADAPT részletes specifikációja |
| [`docs/17-MODULE-06-WATCH.md`](docs/17-MODULE-06-WATCH.md) | WATCH részletes specifikációja |
| [`docs/18-MODULE-08-HOLD.md`](docs/18-MODULE-08-HOLD.md) | HOLD részletes specifikációja |
| [`docs/19-MODULE-09-MEMORY.md`](docs/19-MODULE-09-MEMORY.md) | MEMORY részletes specifikációja |
| [`docs/24-MODULE-05-MULTI.md`](docs/24-MODULE-05-MULTI.md) | MULTI részletes specifikációja |
| [`docs/25-MODULE-16-HANDS.md`](docs/25-MODULE-16-HANDS.md) | HANDS részletes specifikációja (csak VR) |
| [`docs/26-MODULE-17-RISK.md`](docs/26-MODULE-17-RISK.md) | RISK részletes specifikációja |
| [`docs/27-MODULE-18-PROTOCOL.md`](docs/27-MODULE-18-PROTOCOL.md) | PROTOCOL részletes specifikációja |
| [`docs/28-MODULE-19-INTENT.md`](docs/28-MODULE-19-INTENT.md) | INTENT részletes specifikációja |

---

## Új modul hozzáadása

1. Vedd fel a manifesztet `packages/shared/src/modules.ts`-be, kitöltve
   mindhárom terület relevanciáját.
2. Készítsd el a részletes specifikációt a
   [`module-spec-writer`](.claude/skills/module-spec-writer/SKILL.md) skillel:
   `/module-spec-writer WATCH`
3. Implementáld az `AssessmentModule` interfészt
   (`packages/client/src/engine/task/Module.ts`).
4. Regisztráld `packages/client/src/modules/registry.ts`-ben.

A core platformon semmit nem kell módosítani — a kezdőtér, a folyamat, a
naplózás, a pontozás és a mentés a szerződésből következik.

---

## Tesztek

```bash
npm test
```

- `tests/trialmachine.test.ts` — a trial-állapotgép fázissorrendje hamis órával
- `tests/command-scenario.test.ts` — a forgatókönyv-generátor garanciái 480 táblán
- `tests/react-scoring.test.ts` — a REACT pontozása három szintetikus profillal
- `tests/new-modules.test.ts` — SIGNAL, NAV, PRESSURE és ANTICIPATE pontozása,
  a gömbhéj-elrendezés minimális távolsága, és a NAV gráf invariánsai
- `tests/spatial-modules.test.ts` — WATCH, HOLD és MEMORY pontozása, a
  körülvevő elrendezés invariánsai, az SSRT-lépcső és a versenymodell
  ellenőrzése, valamint hogy a térbeli mutatók sík platformon kimaradnak
- `tests/psychophysics.test.ts` — az adaptív lépcső, a lengésellipszis, a
  tremorspektrum, a tanulási görbe és a kopogásstatisztika **ismert válaszú
  szintetikus jelekre**: egy küszöbbecslő, ami nem tudja visszaadni a kapott
  küszöböt, rosszabb a semminél, mert a száma attól még hihetőnek látszik
- `tests/sport-modules.test.ts` — FIELD, STEADY, RHYTHM és ADAPT pontozása,
  a mezősugár-interpoláció, a mozgó szoba hajtófrekvenciás válasza, a
  folytonossági nyereség és a tanulási időállandó, valamint hogy a térbeli
  mutatók sík platformon kimaradnak
- `tests/variants.test.ts` — az A/B változatok bekötése (külön `config_version`,
  külön implementáció, VR-only változatok szűrése), a COMMAND-B szerkezet
  garanciái 480 forgatókönyvön, és hogy az ANTICIPATE-B **visszanyeri a
  méret–érkezés hatást**: azonos szórású, de tau-alapú és méret-heurisztikás
  válaszmintázat elkülönül, és a tau-alapú kap magasabb pontszámot

A `npm test` offline fut, adatbázis és szerver nélkül. A COMMAND többjátékos
útvonalához külön integrációs próba tartozik, ami valódi WebSocket-kapcsolaton
játszik le egy teljes B változatú ülést két klienssel és botokkal:

```bash
node scripts/command-b-e2e.mjs
```

Futó szervert és adatbázist igényel. Ellenőrzi, hogy az ülések tényleg mást
látnak, hogy egyik ülés láthatósági listája sem szivárog át a másikhoz, hogy a
2. körben csak a parancsnok írhatja a leltárt, és hogy a végén a `team_pooling`
nézetből lekérdezhető a **pooling gain**.

---

## API

| Végpont | Leírás |
|---|---|
| `GET /api/health` | Állapot, adatbázis-kapcsolat |
| `GET /api/modules?domain=C` | Modulkatalógus területre szűrve |
| `POST /api/subjects/identify` | Pszeudonim azonosító létrehozása / felismerése |
| `GET /api/subjects/:id/profile?domain=C` | Előzmény, személyes rekordok, profiltengelyek |
| `POST /api/runs` | Futás beküldése (idempotens) |
| `GET /api/runs/:id` | Futás metrikákkal és pontszámokkal |
| `GET /api/leaderboard?module=REACT&domain=C&device=…` | Ranglista, eszközosztályra szűrve |
| `GET /api/analytics/module?module=REACT` | Eloszlás és metrika-aggregátumok |
| `GET /api/export?level=trial&format=csv` | Export (`ADMIN_TOKEN` mellett) |
| `GET /api/rooms` | Aktív COMMAND szobák |
| `WS /ws/command` | COMMAND realtime |

---

## Fontos

Ez **assessment prototípus / demonstrátor**. Teljesítménymutatót ad, nem
validált pszichometriai szakvéleményt. Kiválasztási, foglalkozás-egészségügyi
vagy tehetséggondozási döntés önmagában nem alapozható rá. A validált rendszerhez
konstruktum-definíció, standardizált protokoll, megfelelő minta, test–retest
reliabilitás és normacsoport szükséges, szakértői bevonással.
