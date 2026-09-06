# 14 — MODUL 03: NAV
## Navigáció & téri memória — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/nav/NavModule.ts`
**Támogatott platformok:** VR · asztali · mobil (a mobil korlátaival — lásd 5. fejezet)
**Névleges időtartam:** ~11 perc
**Doménkötés:** A elsődleges · B másodlagos · C másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a NAV azt méri, hogy valaki bejárás közben felépít-e a
környezetről olyan belső modellt, amelyből később **irányt tud mondani olyan
helyre, amit éppen nem lát** — és hogy elveszti-e a tájékozódását, ha nincsenek
tereptárgyak.

### A modul tudományos gerince: útvonaltudás kontra felmérési tudás

A téri tájékozódás kutatásában két, egymástól élesen elváló tudásforma
különböztethető meg, és a modul szerkezete pontosan ezt a különbséget méri:

- **Útvonaltudás** (route knowledge): „a piros toronynál balra”. Egymáshoz
  fűzött, nézőpontfüggő döntések sorozata. Gyorsan kialakul, de merev: csak
  abban az irányban működik, ahogy tanulták, és nem enged meg rövidítést.
- **Felmérési tudás** (survey knowledge): a helyek egymáshoz viszonyított
  térbeli elrendezésének modellje, mintha felülnézetből. Lassabban alakul ki,
  de ebből lehet **soha be nem járt irányt** megmondani, rövidíteni, és
  eltévedés után helyreállni.

Két ember azonos útvonal-teljesítménnyel (2. blokk) gyökeresen különbözhet a
felmérési tudásban (3. és 5. blokk). Katonai szempontból ez a különbség a
lényeg: aki csak útvonaltudással rendelkezik, az az ismert nyomvonalon
használható, de eltévedve nem talál vissza.

A **3. blokk** — irányra mutatás olyan helyre, amelyet a résztvevő nem lát —
a felmérési tudás standard mérőszáma. Az abszolút mutatási hiba fokban a modul
legfontosabb egyetlen száma.

A **4. blokk** (útvonal-integráció, tereptárgy nélkül) azt izolálja, ami akkor
marad, ha nincs mihez kötni magunkat: a saját elmozdulás folyamatos
összegzése. Fontos korlát, hogy fejmozgással történő haladás nélkül ez
**vizuális** útvonal-integráció (optikai áramlásból), nem teljes értékű
testi (vesztibuláris + propriocepciós) integráció — lásd 11. fejezet.

### Mért konstruktumok

| Konstruktum | Katalógus # | Blokk | Paradigma |
|---|---|---|---|
| Téri memória | 15 | 1, 2, 5 | Route learning |
| Irányérzék | 14 | 3 | Judgement of Relative Direction |
| Tájékozódási memória | 60 | 2 | Route retrace |
| Útvonaltervezés | 57 | 2 | Döntési pont választás |
| Eltévedés felismerése | 59 | 2, 4 | Recovery |
| Térképolvasás | 53 | 5 | Map-to-terrain alignment |
| Terepasszociáció | 58 | 1, 2 | Landmark encoding |
| Útvonal-integráció | — | 4 | Triangle completion |

### Amit a modul NEM mér

- **Nem méri a valódi terepi navigációt.** Nincs iránytű, nincs UTM-koordináta,
  nincs domborzatolvasás, nincs időjárás és nincs terhelés. A modul a mögöttes
  téri kognitív gépezetet méri, nem a katonai szaktudást.
- **Nem méri a fizikai állóképességet.** A haladás automatizált; a modul
  ülve is elvégezhető.
- **Nem teljes értékű útvonal-integráció.** Valódi séta nélkül a vesztibuláris
  és propriocepciós csatorna hiányzik. A 4. blokk eredménye kizárólag
  *vizuális* útvonal-integrációként értelmezhető, és ezt a metrika neve is
  kimondja (`visual_path_integration_*`).
- **Nem méri a térképkészítést.** Az 5. blokk térképhez rendel pozíciót és
  irányt; térkép rajzolása (sketch map) nem része.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** A terepen való tájékozódás a gyalogos harcászat
alapkészsége, és a képzés drága: egy hallgató, akinek nincs felmérési tudása,
csak a bejárt nyomvonalon használható. A modul a képzés *előtt* mutatja meg,
hol tart valaki, és a 4. blokk azt is, hogy tereptárgyak nélkül mennyire
tartja az irányt — pontosan az a helyzet, ami éjszaka, ködben vagy egyhangú
terepen áll elő. Beosztások: gyalogos felderítő, navigátor, különleges
műveleti, tüzérségi előretolt figyelő.

**B — Munkaalkalmasság (másodlagos).** Nagy létesítményekben, hálózatokon és
vonalakon dolgozók tájékozódási terhelése: mentőtiszt egy ismeretlen
lépcsőházban, tűzoltó füstben, raktárlogisztikai dolgozó egy 40 000 m²-es
csarnokban, hálózatszerelő alagútrendszerben.

**C — Sport (másodlagos).** A tájfutás gyakorlatilag ez a modul,
terepen futva. Emellett terepfutás, túrakerékpár, vitorlázás és sítúra
tájékozódási komponense.

---

## 3. FELADATSTRUKTÚRA

A környezet **csomópont-alapú**: 12 helyszín, közöttük járható szakaszok.
A haladás nem szabad sétálás, hanem szakaszonkénti, egyenletes sebességű
átcsúszás — lásd 3.6.

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | BEJÁRÁS | 0 | 1 útvonal (8 szakasz) | ~2:10 | kódolás (passzív, standardizált) |
| 2 | ÚJRAJÁRÁS | 1 rövid | 2 útvonal | ~3:00 | útvonaltudás, döntési pontok |
| 3 | IRÁNYBECSLÉS | 2 | 12 | ~2:20 | **felmérési tudás** |
| 4 | ÚTVONAL-INTEGRÁCIÓ | 1 | 8 | ~2:20 | vizuális útvonal-integráció |
| 5 | TÉRKÉP | 1 | 8 | ~1:40 | térkép–terep megfeleltetés |

### 3.1. Blokk 1 — Bejárás (passzív kódolás)

A rendszer végigviszi a résztvevőt egy **8 szakaszból álló útvonalon**.
A haladás automatikus, egyenletes sebességgel; a résztvevő szabadon nézhet
körül, de nem kormányoz.

**Miért passzív?** Mert így minden résztvevő **pontosan ugyanazt** a
vizuális bemenetet kapja: azonos útvonalat, azonos sebességgel, azonos
ideig. Ha a kódolás aktív lenne, aki lassabban halad, több időt kapna a
kódolásra, és a 3. blokkban mért felmérési tudás részben a saját
bejárási stratégiáját tükrözné, nem a téri képességét.

Minden csomóponton **2000 ms megállás**, ami elég a tereptárgy megnézésére.
Az útvonal 6 különböző tereptárgyat érint (kettőt kétszer).

```
szakasz: 1600 ms egyenletes csúszás (max 0,9 rad/s fordulás)
csomópont: 2000 ms megállás, a tereptárgy neve felirattal 1200 ms-ig látszik
```

A tereptárgy neve **csak a bejárás alatt** látszik, később soha.

### 3.2. Blokk 2 — Újrajárás

A résztvevő a kiindulási csomópontnál áll, és el kell jutnia a végpontig
ugyanazon az útvonalon. Minden csomóponton a járható szakaszok
irányjelzőként látszanak; a résztvevő rámutat arra, amerre menni akar.

- **Első útvonal:** ugyanaz, mint az 1. blokkban.
- **Második útvonal:** **fordított irányban**, a végponttól a kiindulásig.

**Miért van fordított futás?** Mert a tiszta útvonaltudás nézőpontfüggő és
irányfüggő: aki csak „a toronynál balra” szintű láncot tanult meg, az
fordítva elakad. A két irány teljesítménykülönbsége
(`reverse_route_cost`) elkülöníti a merev útvonaltudást a rugalmasabbtól.

- **Rossz kanyar:** amikor a résztvevő nem az útvonal szerinti szakaszra lép.
  Ilyenkor a rendszer nem szól; a következő csomóponton derül ki, hogy
  letért. Legfeljebb 3 rossz kanyar után a rendszer visszateszi az utolsó
  helyes csomópontra (`recovery` esemény), hogy a próba befejezhető legyen.
- **Időkorlát:** 150 s útvonalanként.

### 3.3. Blokk 3 — Iránybecslés (JRD)

A résztvevő egy csomópontnál áll, a rendszer elfordítja egy megadott
tereptárgy felé, és egy **másik** tereptárgy irányát kell megmutatnia.
A cél tereptárgy **nem látszik** (köd + takarás), tehát az irány csak
belső modellből származhat.

Instrukció formája: *„A FEHÉR OSZLOPNÁL állsz, a KÉK KAPU felé nézel.
Mutasd meg, merre van a ZÖLD KÚP.”*

- **12 próba**, minden alkalommal más hármas.
- **Válasz:** a mutatót a becsült irányba fordítja, és megerősít.
  A mutatási irány vízszintes komponensét vesszük.
- **Nincs időkorlát**, de a válaszidőt mérjük (30 s után figyelmeztetés).

**Az abszolút mutatási hiba** (0–180°) a felmérési tudás standard mutatója.
Véletlen mutatásnál a várható érték 90°.

### 3.4. Blokk 4 — Útvonal-integráció (háromszög-zárás)

Tereptárgy nélküli, ködbe vesző síkon a rendszer végigviszi a résztvevőt
**két szakaszon** (első szakasz, fordulás adott szöggel, második szakasz).
Ezután a feladat: **mutasd meg, merre van a kiindulópont**, és **milyen
messze**.

- **8 próba**, változó szakaszhosszal (6–14 m) és fordulási szöggel
  (60°, 90°, 120°, 135°).
- A talaj finom textúrája (rács) adja az optikai áramlást; tereptárgy nincs.
- **Válasz:** irány mutatással, távolság egy csúszkával (2–30 m).

Ez a klasszikus háromszög-zárási feladat. Két hibatípus különül el:
a **szöghiba** (a hazafelé irány becslése) és a **távolsághiba**.
Tipikus mintázat, hogy a résztvevők a fordulási szöget alulbecslik és a
távolságot tömörítik — a modul mindkettőt külön méri.

### 3.5. Blokk 5 — Térkép

A résztvevő egy csomópontnál áll, és egy **felülnézeti térképet** kap,
amelyen a csomópontok és a szakaszok látszanak, de a saját pozíciója nem.

- **8 próba:** 4 pozícióbecslés (hol vagyok a térképen?) és
  4 irányítás (merre nézek?).
- **Válasz:** a térképpanelre mutatva jelöli meg a pozíciót, illetve
  egy iránytárcsán az irányt.
- A térkép **mindig északra tájolt**, a résztvevő viszont tetszőleges
  irányba nézhet — így a feladat valódi mentális forgatást igényel, és a
  `map_alignment_cost` (a saját irány és az észak közti szög függvényében
  növekvő hiba) külön kiszámolható.

### 3.6. Haladás és kényelem

**Miért csomópont-alapú?** A szabad, folyamatos kormányzás a VR-kinetózis
legfőbb forrása, és egy 11 perces mérésben rosszullétet okozna, ami
egyben a mérést is tönkretenné. A csomópont-alapú haladás:

- **egyenletes sebesség** (2,4 m/s), gyorsulás nélkül — a gyorsulás okozza
  a vizuális-vesztibuláris konfliktus javát,
- **rövid szakaszok** (1,6 s), így az áramlás sosem tart sokáig,
- **vignetta** a mozgás alatt (a látómező széle 35%-kal sötétül), ami
  igazoltan csökkenti a kellemetlenséget,
- **a fordulás a szakasz elején, helyben, 0,9 rad/s alatt** történik.

Aki így is kellemetlenséget érez, a **TELEPORT** módra válthat (azonnali
átugrás a következő csomópontra, 120 ms sötétítéssel). Ez a mód
rögzítésre kerül (`locomotion_mode`), és a 4. blokk (útvonal-integráció)
teleport módban **nem futtatható** — ott az optikai áramlás maga a bemenet.
Teleport mód esetén a 4. blokk kimarad, és ezt az eredményképernyő kiírja.

---

## 4. INGERDEFINÍCIÓ

**Környezet.** Sík talaj finom ráccsal (2 m osztás), a horizonton
zárógyűrű 60 m sugárban, hogy a tér véges legyen, de irányjelzést ne adjon
(egyenletes, jellegtelen fal). Köd 0,018 sűrűséggel: 40 m-en túl semmi nem
látszik, tehát a tereptárgyak csak közelről azonosíthatók, és a résztvevőnek
mozognia kell a modell felépítéséhez.

**Tereptárgyak.** Hat, primitívekből épített, egyértelműen megkülönböztethető
alakzat. Mindegyik 4–6 m magas, hogy a ködből kiemelkedjen.

| Név | Felépítés | Szín |
|---|---|---|
| FEHÉR OSZLOP | henger, magas, karcsú | `#E8EEF5` |
| KÉK KAPU | két henger + vízszintes hasáb | `#4FC3F7` |
| ZÖLD KÚP | kúp, széles alapú | `#7CF59A` |
| PIROS TORONY | három egymásra rakott, csökkenő kocka | `#FF5C7A` |
| SÁRGA GYŰRŰ | függőleges tórusz oszlopon | `#FFD166` |
| LILA HASÁB | ferde hasáb | `#C6A0FF` |

**Miért csak hat?** Mert a modul a téri elrendezést méri, nem a
tereptárgy-memóriát. Hatnál több esetén a felidézési hiba jelentős része
abból származna, hogy melyik tárgy melyik volt, nem abból, hogy hol.

**Csomópontok.** 12 pont, procedurálisan generált gráf 15–22 m-es
szakaszhosszakkal; minden csomópontnak 2–4 szomszédja. A hat tereptárgy hat
különböző csomópont mellett áll, 5–8 m-re.

**Szakaszjelzők.** A csomóponton állva minden járható szakasz irányában egy
lapos nyíl jelenik meg a talajon, 2,5 m-re, 1,2 m hosszan. Ezekre kell mutatni
a haladáshoz.

**Hang.** Csomópontra érkezéskor halk 660 Hz-es koppanás (60 ms).
Rossz kanyarnál **nincs** hangjelzés — a visszajelzés elrontaná a mérést.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1 Bejárás | `equivalent` | Passzív; a nézelődés módja tér csak el. |
| 2 Újrajárás | `equivalent` | Csomópontválasztás mutatással mindenhol azonos. |
| 3 Iránybecslés | `adapted` | VR-ben testfordulással, asztalon kurzorral mutat. |
| 4 Útvonal-integráció | `adapted` | Ugyanaz; a látómező-különbség számít. |
| 5 Térkép | `equivalent` | Panelre mutatás. |

### Mobil: támogatott, de nem ugyanazt méri

**Korábban ki volt zárva.** Az indoklás az volt, hogy a 3. és 4. blokk
irányválasza a *saját testtengelyhez* viszonyított irány megmutatása, a
telefon látómezeje pedig 20°-nál keskenyebb, a nézőpont forgatása ujjhúzással
történik — ami a testtengely-referenciát megszünteti.

**Ebből az egyik premissza megdőlt, a másik nem.** A mobil látómező azóta
±38°-ra bővült (a látószög telefonon 42°, lásd `Engine.onResize`), tehát a
szűk mező már nem áll. A testtengely-érv viszont áll: ujjal forgatni nem
ugyanaz, mint a testtel fordulni.

A modul mégis fut mobilon, mert **a többi blokk mérése ettől nem sérül**, és a
kizárás azokat is elvette. Amit rögzíteni kell:

| | VR / asztali | Mobil |
|---|---|---|
| 1 Bejárás, 2 Újrajárás, 5 Térkép | ugyanaz | **ugyanaz** |
| 3 Iránybecslés, 4 Útvonal-integráció | egocentrikus, testtengelyhez kötött mutatás | **húzással forgatott nézőpont** — nem testtengely-referenciás |
| `body_turn_count` | ✓ | **hiányzik** |

A 3. és 4. blokk mobilon tehát **irányítási becslést** mér egy elforgatható
nézőpontból, nem egocentrikus mutatást. A `comparability` kulcs (`flat:touch`)
külön tartja ezeket, és mobil eredményt VR-eredménnyel összevetni ezeken a
blokkokon **nem szabad**. A modul kezdőképernyője ezt nem hirdeti; a
specifikáció rögzíti, és az elemzésnek figyelembe kell vennie.

### Mobil irányítás

| Blokk | Mobil megoldás |
|---|---|
| 1 Bejárás | ujjhúzás a körülnézéshez, haladás automatikus |
| 2 Újrajárás | ujjhúzás + koppintás a nyílra |
| 3 Iránybecslés | fordulj a becsült irány felé (célkereszt), majd **ERRE VAN** gomb |
| 4 Útvonal-integráció | ugyanaz, majd natív csúszka a távolsághoz |
| 5 Térkép | koppintás a térképen |

### Adaptációs paraméterek

| Paraméter | VR | Asztali |
|---|---|---|
| Nézőpont-forgatás | fejmozgás + snap-turn (30°) | egérhúzás (jobb gomb) vagy Q/E |
| Irányválasz | a kontroller vízszintes iránya | a kurzor irányából vetített azimut |
| Látómező | ~100° (headset) | 65° |
| Vignetta mozgás közben | 35% | 20% (kevésbé szükséges) |
| Köd látótávolság | 40 m | 40 m |

**A látómező-különbség kompenzálása.** Asztali módban a 65°-os látómező miatt
kevesebb tereptárgy látszik egyszerre, ami a felmérési tudás felépítését
nehezíti. Ezt **nem** kompenzáljuk mesterségesen (pl. a köd növelésével),
mert az más feladatot adna; helyette az eredmény eszközosztályonként külön
kezelendő, és a `comparability` kulcs ezt biztosítja.

### Platformonként kieső metrikák

| Metrika | VR | Asztali |
|---|---|---|
| `body_turn_count` (hányszor fordult körbe) | ✓ | **kiesik** |
| `look_around_range` | ✓ (fejirány) | részleges (kameraforgatás) |
| minden mutatási hiba | ✓ | ✓ |

### Irányítási szöveg platformonként

| Blokk | VR | Asztali |
|---|---|---|
| 1 | „Nézz körül szabadon. A haladás automatikus.” | „Nézz körül a jobb egérgombot nyomva tartva. A haladás automatikus.” |
| 2 | „Mutass a ravasszal arra a nyílra, amerre menni akarsz.” | „Kattints arra a nyílra, amerre menni akarsz.” |
| 3 | „Fordulj a becsült irányba, és húzd meg a ravaszt.” | „Fordítsd a kurzort a becsült irányba és kattints.” |
| 4 | „Mutass a kiindulópont felé, majd állítsd be a távolságot.” | „Kattints a becsült irányba, majd állítsd be a távolságot.” |
| 5 | „Mutass a térképen arra a pontra, ahol állsz.” | „Kattints a térképen arra a pontra, ahol állsz.” |

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: az útvonal hossza, a csomópontok fokszáma (több elágazás),
a tereptárgyak száma és megkülönböztethetősége, a köd sűrűsége, a
háromszög-zárásnál a szakaszhossz és a fordulási szög, a térképnél a
saját irány és az észak közti szög.

### `NAV_STANDARD_A` (alapértelmezés)

```
nodes 12   landmarks 6   fogDensity 0.018   legMs 1600   dwellMs 2000
routeLength 8   retraceRoutes 2 (előre + fordított)   retraceTimeoutMs 150000
jrdTrials 12   triangleTrials 8   legRange [6,14]   turnAngles [60,90,120,135]
mapTrials 8 (4 pozíció + 4 irány)
```

### `NAV_SHORT` (~6 perc, szűrésre)

```
routeLength 6   retraceRoutes 1 (csak előre)   jrdTrials 8
triangleTrials 5   mapTrials 4
```

### CHALLENGE mód

Több csomópont (16), sűrűbb köd (0,03), rövidebb megállás (1200 ms).
Az assessment eredménnyel nem keverhető, mert a kódolási idő eltér.

---

## 7. METRIKÁK

### Nyers (próbánként)
`routeIndex` · `nodeSequence` · `chosenEdge` · `correctEdge` · `wrongTurn` ·
`legTimeMs` · `jrdStandNode` · `jrdFacingLandmark` · `jrdTargetLandmark` ·
`jrdPointedDeg` · `jrdTrueDeg` · `triangleLegs` · `triangleTurnDeg` ·
`triangleTrueBearing` · `triangleTruDistance` · `pointedBearing` ·
`estimatedDistance` · `mapMode` · `mapClickX/Y` · `mapTrueX/Y` · `headingOffsetDeg`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `retrace_success_forward` | Hibátlanul teljesített döntési pontok aránya az előre irányú újrajáráson |
| `retrace_success_reverse` | Ugyanaz fordított irányban |
| `reverse_route_cost` | `retrace_success_forward − retrace_success_reverse`; magas érték = merev, nézőpontfüggő útvonaltudás |
| `wrong_turns` | Összes rossz kanyar |
| `optimal_route_ratio` | A megtett szakaszok száma / az optimális szakaszszám |
| `recovery_time` | Medián idő az első rossz kanyartól a visszatalálásig (s) |
| `jrd_absolute_error` | **Fő mutató.** Medián abszolút mutatási hiba fokban (0–180) |
| `jrd_error_sd` | A mutatási hibák szórása — a modell konzisztenciája |
| `jrd_within_45` | A 45°-nál pontosabb válaszok aránya (a „tudja, merre van” küszöb) |
| `jrd_response_time` | Medián válaszidő |
| `jrd_signed_bias` | A hibák cirkuláris átlaga: rendszeres balra/jobbra torzítás |
| `visual_path_integration_bearing_error` | Medián abszolút szöghiba a háromszög-zárásban |
| `visual_path_integration_distance_error` | Medián |becsült − valós| / valós távolság |
| `distance_compression` | A becsült/valós távolságarány mediánja; <1 = tömörítés |
| `turn_underestimation` | A fordulási szög becsült/valós aránya a hazafelé irányból visszaszámolva |
| `map_position_error` | Medián távolság a térképen jelölt és a valós pozíció között, méterben |
| `map_heading_error` | Medián abszolút irányhiba fokban |
| `map_alignment_cost` | A térképhiba regressziós meredeksége az észak–saját irány szög ellen |
| `landmark_recall_accuracy` | Helyesen azonosított tereptárgy-csomópont párok aránya |
| `body_turn_count` | Hányszor fordult körbe 180°-nál nagyobbat (csak VR) |
| `locomotion_mode` | `glide` vagy `teleport` |
| `discomfort_reported` | 0/1 — kért-e teleport módot menet közben |

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `survey_knowledge` | JRD hiba 20° | 90° | 90° = véletlen mutatás; 20° a jó teljesítmény sávja. **Provizórikus** |
| `route_knowledge` | 100% helyes döntés | 45% | 2–4 szomszédnál a véletlen 33–50% |
| `path_integration` | szöghiba 15° | 75° | **Provizórikus** |
| `map_skill` | pozícióhiba 2 m | 14 m | A gráf átmérőjéhez viszonyítva |
| `route_flexibility` | `reverse_route_cost` 0 | 0,5 | 0 = teljesen irányfüggetlen tudás |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Felmérési tudás (JRD) | 0,30 |
| Útvonaltudás (újrajárás) | 0,22 |
| Útvonal-integráció | 0,18 |
| Térképkészség | 0,16 |
| Útvonal-rugalmasság (fordított futás) | 0,14 |

A JRD kapja a legnagyobb súlyt, mert az a legkevésbé megkerülhető: az
útvonalat végig lehet találgatni, egy nem látható tereptárgy irányát nem.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `nav_graph_built` | nodes, edges, landmarkNodes, seed |
| `tour_leg` | from, to, legIndex, durationMs |
| `tour_landmark_shown` | landmark, node |
| `retrace_start` | routeIndex, direction, expectedNodes |
| `edge_chosen` | from, to, correct, elapsedMs, optionsCount |
| `wrong_turn` | node, chosen, expected, count |
| `retrace_recovery` | returnedToNode, wrongTurnsBefore |
| `retrace_end` | routeIndex, success, wrongTurns, durationMs |
| `jrd_prompt` | standNode, facing, target |
| `jrd_response` | pointedDeg, trueDeg, absErrorDeg, rtMs |
| `triangle_start` | leg1, turnDeg, leg2 |
| `triangle_response` | bearingErrorDeg, distanceRatio, rtMs |
| `map_prompt` | mode, node, headingOffsetDeg |
| `map_response` | errorMeters or errorDeg, rtMs |
| `locomotion_mode_changed` | mode, atNode |

**Mozgásnaplózás: 10 Hz.** A fej iránya és a pozíció; ebből rekonstruálható
a teljes bejárt pálya és a nézelődési mintázat. Sűrűbb mintavétel nem kell,
mert itt nincs ezredmásodperces esemény. Egy 11 perces futás ~6600 minta.

---

## 9. ADATBÁZIS

Új tábla nem kell. A gráf a `trials.stimulus`-ban utazik az első próbával,
hogy a futás utólag rekonstruálható legyen:

```jsonc
// tour
{ "kind": "tour", "route": [0,3,7,2,5,9,1,4], "landmarks": {"0":"FEHÉR OSZLOP"},
  "graph": { "nodes": [[x,z],...], "edges": [[0,3],[3,7],...] }, "seed": 123456 }
// retrace
{ "kind": "retrace", "routeIndex": 1, "direction": "reverse", "expected": [4,1,9,...] }
// jrd
{ "kind": "jrd", "standNode": 3, "facing": "KÉK KAPU", "target": "ZÖLD KÚP", "trueBearingDeg": 118.4 }
// triangle
{ "kind": "triangle", "leg1": 9.2, "turnDeg": 120, "leg2": 11.6,
  "trueBearingDeg": -142.8, "trueDistance": 12.4 }
// map
{ "kind": "map", "mode": "position", "node": 7, "headingOffsetDeg": 74 }
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „NAV / Navigáció & téri memória”, az öt blokk listája,
   plusz egy kényelmi figyelmeztetés: *„Ha bármikor kellemetlenül érzed magad,
   a TELEPORT gombbal átválthatsz ugrásos haladásra.”*
2. **KALIBRÁCIÓ** — a résztvevő megnézi a hat tereptárgyat egy
   „bemutató körön” (mindegyik 1,5 s-ig, névvel). Ez nem mérés: enélkül a
   bejárás közben azzal telne az idő, hogy megtanulja, mi micsoda.
3. **INSTRUKCIÓ** blokkonként.
4. **GYAKORLÁS** a 2–5. blokkban (a bejárásnál nincs értelme).
5. **MÉRÉS**.
6. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Iránybecslési hiba | `28°` (45° alatt: `75%`) |
| Útvonal-újrajárás | `92%` előre · `71%` fordítva |
| Útvonal-rugalmasság | `0,21` |
| Útvonal-integráció | `34°` szöghiba · `0,78` távolságarány |
| Térképpozíció | `3,4 m` |
| Rossz kanyarok | `2` |

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A 2. blokk útvonal-újrajárási elrendezés. A 3. blokk a
Judgement of Relative Direction feladat, a felmérési tudás standard
mérőszáma. A 4. blokk háromszög-zárás. Az 5. blokk térkép–terep
megfeleltetés.

**Eltérések.** (a) A klasszikus háromszög-zárás **valódi sétával**,
gyakran bekötött szemmel történik, és a vesztibuláris + propriocepciós
bemenetre épül. Itt csak optikai áramlás van, tehát a mért képesség a
vizuális útvonal-integráció — ez gyengébb és más, mint a testi.
A metrikanevek ezt kimondják. (b) A JRD eredeti formája íróasztalnál,
papíron, iránytárcsával történik; itt testfordulással, ami ökológiailag
érvényesebb, de nagyobb motoros zajt visz. (c) A környezet procedurális és
absztrakt, nem valós terep — ez a standardizálás ára.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3):
JRD abszolút hiba mediánja 25–55° · 45° alatti válaszok aránya 45–80% ·
előre irányú újrajárás 80–100% · fordított 55–90% ·
háromszög-zárási szöghiba 25–50° · távolságarány 0,6–0,9 (tömörítés a szokásos) ·
térképpozíció-hiba 2–8 m. Asztali módban a JRD hiba jellemzően 5–12°-kal nagyobb.

**Erős egyéni különbségek.** A téri tájékozódás az egyik legnagyobb egyéni
szórású kognitív képesség: a JRD hiba egészséges felnőtteknél 10° és 90°
között szóródik. Ez a modul értékét adja (jól diszkriminál), de azt is
jelenti, hogy **egyetlen rossz eredményből nem következik hiányosság** —
a nap szaka, a fáradtság és a VR-tapasztalat mind számottevően befolyásolja.

**Kinetózis mint konfundáló tényező.** Aki rosszul lesz, rosszabbul is
teljesít, és ez nem téri képesség. Ezért a `locomotion_mode` és a
`discomfort_reported` minden futásban rögzül, és az elemzésnek ki kell
zárnia vagy külön kezelnie a teleport módban futott méréseket.

**Tanulási hatás.** Az **környezet ismerete** erősen tanulható: ugyanaz a
gráf második felvételnél lényegesen jobb eredményt ad. Ezért ismételt
mérésnél **kötelező más seed** — a gráf, a tereptárgy-elhelyezés és az
útvonal is seedből generálódik.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. A generált gráf összefüggő: minden csomópont elérhető minden csomópontból.
2. Minden csomópontnak 2 és 4 közötti szomszédja van.
3. A hat tereptárgy hat különböző csomóponthoz tartozik.
4. Az 1. blokk útvonala pontosan 8 szakaszból áll, és nem használ élt kétszer
   egymás után oda-vissza.
5. Két azonos seedű futás azonos gráfot, azonos tereptárgy-elhelyezést és
   azonos útvonalat ad.
6. A JRD-ben a cél tereptárgy soha nem látható a válasz pillanatában
   (köd + távolság ellenőrizve).
7. A JRD igazi irány (`trueBearingDeg`) a csomópont és a cél tereptárgy valós
   geometriájából számolódik, nem a gráfból.
8. Az abszolút mutatási hiba mindig 0 és 180 fok közé esik.
9. A háromszög-zárás blokkban egyetlen tereptárgy sem látszik.
10. Teleport módban a 4. blokk kimarad, és ezt az eredmény rögzíti.
11. A mozgás alatt a fordulási sebesség sosem lépi túl a 0,9 rad/s-ot.
12. Három rossz kanyar után a rendszer visszateszi a résztvevőt az utolsó
    helyes csomópontra, és ezt `retrace_recovery` eseményként naplózza.
13. A modul kilépéskor a jelenet ködjét és háttérszínét visszaállítja arra,
    amit a Room beállított.
14. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
15. Szintetikus profilokon (jó / átlagos / gyenge navigátor) az OPS pontszám
    monoton csökkenő, legalább 180 pont különbséggel a szélsők között.
