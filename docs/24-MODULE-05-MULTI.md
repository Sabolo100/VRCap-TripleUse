# 24 — MODUL 05 · MULTI · Többfeladatos terhelés

**Kód:** `MULTI` · **Sorszám:** 05 · **Verzió:** 0.1.0
**Konfiguráció:** `MULTI_STANDARD_A` (alap), `MULTI_SHORT` (rövid)
**Platform:** VR · asztali · mobil — **eltérő elrendezéssel** (lásd 5.)
**Paradigma:** NASA MATB-II (Multi-Attribute Task Battery), Comstock & Arnegard (1992)
**Kapcsolódó dokumentumok:** `00-MASTER-SPEC.md` 5/05, `02-CROSSPLATFORM-INTERACTION.md`,
`03-SPATIAL-DESIGN.md`

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban.** A MULTI azt méri, **mennyivel romlik minden egyes részfeladat
attól, hogy közben a többit is csinálni kell** — és hogyan osztja el a felhasználó
a felügyeletét négy egyidejű állomás között, amikor nem futja mindegyikre.

Ez a modul az egyetlen, amelynek a fő mutatója **különbség**, nem szint. Egy
terhelés alatti követési hiba önmagában értelmezhetetlen: nem tudjuk, hogy az
illető rosszul osztja meg a figyelmét, vagy egyszerűen rosszul követ. Ezért a
modul minden állomást **egyedül is** lefuttat egy alapvonal-blokkban, és a
`dual_task_cost` a kettő aránya.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Honnan | Katalógus |
|---|---|---|---|
| Megosztott figyelem | Egyidejű, egymással versengő információforrások párhuzamos felügyelete | MATB-II, dual-task paradigma | 23 |
| Többfeladatosság | Több, egymástól független feladatcél egyidejű fenntartása | MATB-II | 24 |
| Feladatváltás | A válaszkészlet átállításának költsége állomások között | task switching (Rogers & Monsell logikája) | 28 |
| Információs túlterhelés | Az a pont, ahol az eseménysűrűség növelése már nem lassulást, hanem kihagyást okoz | MATB-II eseményráta-manipuláció | 50 |
| Dual-task cost | `(terhelt − alapvonal) / alapvonal`, állomásonként | dual-task paradigma | 131 |
| Beszédértés zajban | Saját hívójel felismerése zajba ágyazott közlésből | MATB-II COMM alfeladat | 94 |

### Amit a modul kifejezetten NEM mér

- **Nem méri a „stressztűrést”.** A terhelés alatti teljesítményromlás
  teljesítménymutató, nem személyiségjegy. Az eredmény megfogalmazása kötelezően
  „megfigyelt teljesítmény négy egyidejű feladat mellett”.
- **Nem méri a munkamemória-kapacitást.** Az itt fellépő korlát a figyelem
  elosztásáé; kapacitásmérésre a MEMORY való.
- **Nem méri a hallásküszöböt.** A COMM alfeladat rögzített, kényelmes
  hangerőn megy; ha valaki nem hallja, az beállítási vagy hallásprobléma, és a
  modul ezt eseményként jelzi, nem pontszámként.
- **Nem ad alkalmassági ítéletet** semmilyen munkakörre. A többfeladatos
  terhelhetőség egy szempont a sok közül.
- **Nem méri a tekintetet.** A Quest 3-ban nincs szemkövetés; amit mérünk, az a
  **fejirány**, és a metrikák neve ezt mondja ki (`head_facing_station`).

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — védelmi (`primary`).** A harcálláspont és a járművezetői munkahely
definíció szerint többcsatornás: rádióforgalom, műszerfelügyelet, célkövetés és
döntés egyszerre. A műveleti hibák jelentős része nem abból származik, hogy
valaki valamelyik részfeladatot nem tudta elvégezni, hanem abból, hogy közben a
másikat elengedte. A `neglect_time_s` pontosan ezt méri.
*Munkakörök:* harcjárművezető, pilóta, harcálláspont-kezelő, tűzvezető,
rádiós-műszerkezelő.

**B — munka (`primary`).** A légiirányítás, a mentésirányítás és az
aneszteziológia esetében a párhuzamos csatornák kezelése nem a munkakör
mellékkörülménye, hanem a lényege. Ezekben a szakmákban a MATB-II a bevett
laboratóriumi analógia, tehát a modul eredménye a szakirodalommal
összevethető — a `comparability` kulcs figyelembevételével.
*Munkakörök:* légiforgalmi irányító, mentésirányító diszpécser, aneszteziológus,
vezérlőtermi operátor, intenzív osztályos ápoló.

**C — sport (`secondary`).** A csapatsportban az osztott figyelem valós, de a
MATB-II absztrakt állomásai messze esnek a játékhelyzettől; ott a SIGNAL MOT
blokkja és a WATCH közelebbi analógia. Ezért másodlagos.
*Sportágak:* kosárlabda-irányító, kézilabda-kapus mezőnyjátékosként, vitorlás
kormányos, rally-navigátor.

---

## 3. FELADATSTRUKTÚRA

### 3.1. A négy állomás

| Állomás | Mit csinál | Válasz | Folytonos? |
|---|---|---|---|
| **TRACK** — követés | Egy korong elsodródik a középső gyűrűből; vissza kell nullázni | analóg kar (thumbstick / billentyű / virtuális kar) | igen |
| **MONITOR** — rendszerfigyelés | Két jelzőfény és négy skála; eseménykor válaszolni kell | mutatás + `PRIMARY` | esemény |
| **RESOURCE** — erőforrás-tartás | Két tartály szintjét sávban kell tartani szivattyúkkal | mutatás + `PRIMARY` a szivattyún | folytonos, lassú |
| **COMM** — rádió | Hívások érkeznek; csak a **saját hívójelre** kell válaszolni | mutatás a csatornalapra | esemény |

### 3.2. Blokkok

| # | Blokk | Cél | Tartam | Gyakorlás | `unitLabel` |
|---|---|---|---|---|---|
| 1 | `baseline` | Mindegyik állomás **egyedül**, sorban | 4 × 50 s = 200 s | 4 × 15 s | `állomás` |
| 2 | `dual` | TRACK + MONITOR együtt | 80 s | 25 s | `menet` |
| 3 | `load` | Mind a négy, két eseményrátán | 2 × 140 s = 280 s | 30 s | `terhelési szint` |

**Mérési idő:** 560 s (9 perc 20 s). Gyakorlással, instrukcióval, eredménnyel
együtt kb. 12 perc. A `MULTI_SHORT` konfiguráció felezi a `load` blokkot
(2 × 80 s) és 35 s-ra rövidíti az alapvonalakat: összesen 300 s.

**Miért három terhelési szint.** Egy alapvonal és egy terhelt mérés csak egy
különbséget ad. Három pont (1, 2, 4 egyidejű feladat) **meredekséget** ad, és a
meredekség az, ami elkülöníti azt, aki egyenletesen romlik, attól, aki egy
darabig hibátlan, aztán összeomlik (`load_slope`, `overload_knee`).

### 3.3. A trial anatómiája

A MULTI **nem próbaalapú modul**: két állomás folytonos, kettő eseményvezérelt.
A szabvány állapotgép ezért **eseményenként** fut, az állomás saját eseményére:

```
PREPARE          az esemény ütemezése (a blokk elején generált listából)
COUNTDOWN        nincs — a felhasználót nem figyelmeztetjük, ez a lényeg
STIMULUS         az állomás állapotváltása (fény kialszik, skála kifut,
                 szivattyú meghibásodik, hívás megszólal)
RESPONSE WINDOW  MONITOR 8000 ms · COMM 10000 ms · RESOURCE nincs (folytonos)
RESPONSE         mutatás + PRIMARY a helyes elemre
FEEDBACK         csak gyakorlásban: az elem 400 ms-ig zöld/piros
INTER-TRIAL      nincs; a következő esemény a saját ütemezése szerint jön
```

A folytonos állomások (TRACK, RESOURCE) nem eseményekben, hanem **1 Hz-es
mintákban** kerülnek a naplóba, plusz a TRACK teljes hibajele 20 Hz-en.

### 3.4. Eseményütemezés és eloszlások

| Paraméter | `baseline` | `dual` | `load` alacsony | `load` magas |
|---|---|---|---|---|
| MONITOR esemény / perc | 5 | 5 | 5 | 10 |
| COMM hívás / perc | 4 | — | 4 | 7 |
| ebből **saját** hívójel | 40% | — | 40% | 40% |
| Szivattyúhiba / perc | 1,5 | — | 1,5 | 3 |
| Követés forgatófüggvény erősítés | 1,0× | 1,0× | 1,0× | 1,45× |

Az esemény-időközök **exponenciális eloszlásból** jönnek, 3,5 s alsó
levágással, hogy két esemény soha ne fedje egymást olvashatatlanul, de a
következő esemény időpontja megjósolhatatlan maradjon. A MONITOR események
típusa egyenletesen oszlik a hat elem között (2 fény + 4 skála), a
véletlen sorrendet a futás seedje határozza meg.

**Fals riasztás lehetősége kötelező.** Ha nincs mód rossz elemre válaszolni, a
találati arány önmagában nem értelmezhető. Minden MONITOR elem bármikor
megnyomható; eseményen kívüli megnyomás `false_alarm`.

---

## 4. INGERDEFINÍCIÓ A PRIMITÍVKÖNYVTÁRBÓL

Minden elem primitívekből és canvas-panelekből épül. Külső 3D asset nincs.

### 4.1. TRACK állomás

| Elem | Geometria | Méret (m) | Szögméret | Szín |
|---|---|---|---|---|
| Céltgyűrű | `torus` | átm. 0,26 · cső 0,012 | 7,4° @ 2,0 m | `theme.textMuted` |
| Hibakorong | `sphere` | átm. 0,072 | 2,1° | `theme.accent` |
| Sávjelző | `ring` | átm. 0,52 | 14,8° | `accent` 22% |

A hibakorong a gyűrű középpontjától eltolva jelenik meg; az eltolás **maga a
hibajel**. 1 fok hiba = 0,0349 m eltolás 2,0 m-en.

**Forgatófüggvény.** A sodródás nem-harmonikus szinuszok összege, hogy ne
legyen megtanulható:

```
vx(t) = Σ  Ai · sin(2π·fi·t + φi)      f = [0,043 · 0,097 · 0,211 · 0,367] Hz
vy(t) = Σ  Bi · sin(2π·fi·t + ψi)      A, B = [1,9 · 1,4 · 0,9 · 0,55] °/s
```

A fázisok (`φ`, `ψ`) a futás seedjéből származnak. A hiba integrálva:
`e += (vForcing(t) − k·stick) · dt`, `k = 9,0 °/s` teljes kitérésnél,
a hiba ±12°-ra vágva (a vágás nélkül egy elhagyott követés végtelenbe futna,
és az RMS a blokkhossztól függene, nem a viselkedéstől).

### 4.2. MONITOR állomás

Egy 0,86 × 0,58 m panel (24,5° × 16,6° @ 2,0 m).

| Elem | Rajz | Nyugalmi állapot | Esemény |
|---|---|---|---|
| ZÖLD fény | kitöltött kör, r = 34 px | világít | **kialszik** |
| PIROS fény | kitöltött kör, r = 34 px | sötét | **felgyullad** |
| Skála 1–4 | függőleges sáv + mutató | mutató ±1 osztás közepén ingadozik (0,3 Hz) | mutató **≥3 osztásra** tolódik és ott marad |

Az esemény addig tart, amíg meg nem nyomják, vagy le nem jár a 8 s.
A skálamutatók nyugalmi ingadozása azért van, mert egy mozdulatlan mutató
elmozdulása perifériásan is észrevehető; a folyamatos mozgás elveszi ezt a
könnyebbséget, és a feladat valóban felügyeletet kíván.

### 4.3. RESOURCE állomás

Egy 0,86 × 0,58 m panel.

- **A** és **B** főtartály: 4000 egység, cél 2500, elfogadható sáv 2000–3000.
- Elfolyás: 30 egység/s tartályonként, folyamatos.
- Négy szivattyú (P1, P2 → A; P3, P4 → B), egyenként 45 egység/s, ki/be
  kapcsolható mutatással.
- Egy szivattyú véletlenszerűen **meghibásodik** (pirosra vált, nem szállít);
  átlagosan 22 s után magától helyreáll.

A számok úgy vannak beállítva, hogy **egy** működő szivattyú tartályonként
kevés (45 − 30 = +15 e/s, de két tartály ellátása két szivattyút kíván),
**kettő** viszont túltölt: tehát a felügyelet folyamatos beavatkozást kíván,
és nincs „állítsd be és felejtsd el” megoldás.

### 4.4. COMM állomás

Egy 0,70 × 0,52 m panel négy csatornalappal (1–4) és a hívójel kijelzésével.

- **Hívójel:** NATO-betűszó + számjegy (`KILO 4`), a kalibrációnál kap egyet a
  felhasználó, és a panel bal felső sarkában végig látszik.
- **Hívás:** „⟨hívójel⟩, ⟨szám⟩-es csatorna”. Web Speech API-val, ha elérhető.
- **Zaj:** a hívás alatt szélessávú zaj szól, `snrDb` = +8 (alacsony terhelés)
  és +3 (magas terhelés). Ez **névleges, amplitúdóarány-alapú** érték
  (`20·log10(hangerő / zajerő)`), nem kalibrált hangnyomásszint-különbség: a
  böngésző kimeneti szintjét nem ismerjük. Reprodukálható manipuláció, de a
  szakirodalmi SNR-értékekkel nem vethető össze, és a napló a tényleges
  `toneGain` / `noiseGain` értéket is tárolja.
- **Válasz:** a megnevezett csatornalapra mutatni, 10 s-on belül.
  Idegen hívójelre **nem** szabad válaszolni — az `false_alarm`.

**Ha nincs beszédszintézis** (a Quest böngészőjében nem garantált), a hívás
hangkódolt: a hívójel betűjét egy 3 hangból álló, minden hívójelhez egyedi
motívum kódolja, a számot pedig 1–4 rövid csipogás. A futás rögzíti, melyik
csatornán ment (`commChannel: 'speech' | 'tones'`), és **a két változat
`audio_hit_rate`-je nem hasonlítható össze.** Az eredményképernyő ezt kiírja.

### 4.5. Térbeli elrendezés

**VR (körülvevő).** Az állomások 2,0 m-en, szemmagasságban:

```
                  COMM  ±138°
                     ·
   MONITOR −68°  ·        ·  RESOURCE +68°
                     ·
                 TRACK 0°, −6°
```

A Quest 3 vízszintes fél-látómezeje ≈ 55°, a MONITOR panel fél-szélessége
12,3°: a panel 55,7°-tól 80,3°-ig terjed, tehát **a követésre nézve nem
látszik**. Ez a modul térbeli lényege: nem lehet mindent egyszerre nézni, és
ami nincs a látómezőben, arról nem érkezik információ.

A COMM oldala (`+138°` vagy `−138°`) futásonként sorsolt, és a futás
rögzíti — így a „mindig jobbra fordulok” szokás nem ad előnyt egy
ismételt mérésnél.

**Sík platformok (asztali, mobil).** A körülvevő elrendezés fizikailag nem
mutatható meg, ezért ott a **klasszikus MATB-II elrendezés** fut: mind a négy
állomás egyszerre látható.

| | asztali | mobil (fekvő) |
|---|---|---|
| TRACK | 0°, −12° | 0°, −11° |
| MONITOR | −30°, 0° | −26°, 0° |
| RESOURCE | +30°, 0° | +26°, 0° |
| COMM | 0°, +18° | 0°, +14° |
| panel szélesség | 0,78 m | 0,62 m |

A mobil fekvő nézet **függőleges** látómezeje 42°, a vízszintes ebből
16:9-nél kb. 75° — ezért szűkebb a függőleges elrendezés, mint a vízszintes.
A 0,62 m széles panel 2,0 m-en 17,6°-ot fed, tehát a ±26°-os oldalsó
állomások széle 34,8°-nál van, éppen a 37,5°-os fél-látómezőn belül.

Ez **nem** ugyanaz a mérés (lásd 5.), és a modul ezt kimondja.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

### 5.1. Besorolás

| Feladatelem | Osztály | Indoklás |
|---|---|---|
| Követés (TRACK) | `adapted` | analóg kar mindhárom platformon van, de a felbontása különbözik |
| Rendszerfigyelés | `equivalent` | esemény észlelése és mutatás; a *hova* nem konstruktum |
| Erőforrás-tartás | `equivalent` | ugyanaz a szabályrendszer |
| Rádió | `equivalent` | hallás és mutatás |
| **Körülvevő elrendezés** | `vr-only` | 68° és 138° egy 75°-os vízszintes látómezőben nem létezik |
| **Figyelemelosztás fejirányból** | `vr-only` | sík platformon a fejirány nem létezik |

### 5.2. A kar leképezése

| | VR | asztali | mobil |
|---|---|---|---|
| Vezérlő | **bal** thumbstick | `WASD` / nyilak | **virtuális kar** a vezérlősáv bal oldalán |
| Felbontás | analóg, 0–1 folytonos | bináris (0 vagy 1) | analóg, 0–1 folytonos |
| Válaszkéz | bal (a jobb szabad a mutatásra) | bal (az egér a jobb kézben) | bal hüvelyk (a jobb hüvelyk koppint) |
| `stickResolution` a naplóban | `analog` | `digital` | `analog` |

**Mindhárom platformon két kéz dolgozik párhuzamosan** — ez szándékos.
Ha a követés és a válasz ugyanazt a kezet foglalná, a modul nem megosztott
figyelmet mérne, hanem kézütemezést. A billentyűzetes bináris kar rosszabb
követést ad; ezért az asztali `tracking_rms` **nem** vethető össze a másik
kettővel, és a `comparability` kulcs ezt eleve elkülöníti.

### 5.3. Platformonként kieső metrikák

| Metrika | vr | desktop | mobile | Miért |
|---|---|---|---|---|
| `station_dwell_entropy` | ✓ | — | — | nincs fejirány, és minden állomás egyszerre látszik |
| `neglect_time_s` | ✓ | — | — | ugyanaz |
| `orientation_cost_ms` | ✓ | — | — | nincs mit elfordítani |
| `rear_station_hit_rate` | ✓ | — | — | nincs hátsó állomás |
| `tracking_rms` | ✓ | ✓ (más skálán) | ✓ | — |
| `dual_task_cost` | ✓ | ✓ | ✓ | a konstruktum mindhárom platformon él |

A kieső mutatók **hiányoznak**, nem nullák és nem becsültek. A pontozás
súlyai sík platformon átskálázódnak, és a futás `spatialWeightsApplied: false`
értékkel rögzül.

### 5.4. `controlHint`

| Platform | Szöveg |
|---|---|
| VR | `BAL KAR: követés · JOBB RAVASZ: válasz az állomásokon` |
| asztali | `WASD: követés · KATTINTÁS: válasz az állomásokon` |
| mobil | `BAL HÜVELYK: kar · KOPPINTÁS: válasz az állomásokon` |

---

## 5/B. MOBIL VEZÉRLŐKÉSZLET

| Blokk | `buttons` | `stick` | `dial` | `slider` | `look` | `hint` |
|---|---|---|---|---|---|---|
| `baseline` / TRACK | — | ✓ (bal) | — | — | `off` | „Tartsd a korongot a gyűrű közepén.” |
| `baseline` / MONITOR | — | — | — | — | `off` | „Koppints arra az elemre, ami eltér.” |
| `baseline` / RESOURCE | — | — | — | — | `off` | „Tartsd mindkét tartályt a zöld sávban.” |
| `baseline` / COMM | — | — | — | — | `off` | „Csak a saját hívójeledre válaszolj.” |
| `dual` | — | ✓ (bal) | — | — | `off` | „Kar bal hüvelykkel, válasz jobbal.” |
| `load` | — | ✓ (bal) | — | — | `off` | „Mind a négy állomás egyszerre.” |

**Három állítás.**

1. **A követés `stick`, nem gomb.** Az analóg kar az egyetlen kontroll, ami
   folytonos hibajelet tud nullázni; egy gombsor ezt kvantálná, és a
   `tracking_rms` a gombfelbontást mérné. A `stick` a `MobileControls` réteg
   új eleme, és bármelyik későbbi modul használhatja (NAV mozgás, ADAPT).
2. **`look: 'off'` mindenhol.** A modul folyamatosan időt mér, és a
   `02-CROSSPLATFORM-INTERACTION.md` 3.5. pontja szerint a húzásos körbenézés
   a `pointerup`-ig halasztaná a `PRIMARY`-t. Mobilon ezért nincs körbenézés —
   és nincs is mit körbenézni, mert minden állomás látszik.
3. **A kar sávja nem takarhatja az állomásokat.** A `stick` a bal alsó sarokba
   kerül, a `reportInset` a magasságát jelenti a motornak, és a négy állomás
   elrendezése ehhez az insetelt viewporthoz igazodik.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Mi teszi nehezebbé.** Az eseménysűrűség (MONITOR/perc, hívás/perc,
szivattyúhiba/perc), a követés forgatófüggvényének erősítése, a hívások
jel-zaj viszonya, és — VR-ben — az állomások szöghelyzete.

### `MULTI_STANDARD_A`

```
baselineSeconds        50   (állomásonként)
dualSeconds            80
loadSeconds            140  (szintenként)
monitorEventsPerMin    5 / 10       (alacsony / magas)
commCallsPerMin        4 / 7
ownCallSignRatio       0,40
pumpFailuresPerMin     1,5 / 3
forcingGain            1,00 / 1,45
snrDb                  +8 / +3
monitorWindowMs        8000
commWindowMs           10000
stationAzDeg (vr)      TRACK 0 · MONITOR −68 · RESOURCE +68 · COMM ±138
stationAzDeg (flat)    TRACK 0 · MONITOR −34/−26 · RESOURCE +34/+26 · COMM 0
trackClampDeg          12
```

### `MULTI_SHORT`

```
baselineSeconds        35
dualSeconds            50
loadSeconds            80
minden egyéb           azonos
```

A rövid változat a **kutatási** és ismételt mérési használatra van: ugyanazok a
paraméterek, kevesebb adat. A `dual_task_cost` becslésének szórása ezzel
nagyjából 1,3-szorosára nő, ezért a két konfiguráció eredményei **külön
normacsoportba** kerülnek (`config_version` szerint), ahogy az A/B változatoknál.

### CHALLENGE mód

Az eseményráta a teljesítményhez igazodik: minden 20 s-os ablakban, ha a
találati arány > 85% és a követési RMS a saját alapvonal 1,2-szerese alatt van,
az eseményráta 15%-kal nő; ha a találati arány < 60%, 15%-kal csökken. Élő
pontszám látszik. **Az eredmény soha nem kerül assessment normacsoportba**,
mert az adaptív ráta miatt két futás nem ugyanazt a feladatot jelenti.

---

## 7. METRIKÁK

### 7.1. Nyers (eseményenként / mintánként)

| Név | Mértékegység | Mikor |
|---|---|---|
| `track_error_deg` | fok | 20 Hz, folytonosan a TRACK aktív ideje alatt |
| `stick_magnitude` | 0–1 | 20 Hz |
| `monitor_event` | — | típus, elem, onset |
| `monitor_response` | ms | RT az onsettől; helyes elem igen/nem |
| `comm_call` | — | hívójel, saját-e, csatorna, `snrDb` |
| `comm_response` | ms | RT; a választott csatorna |
| `tank_level_a/b` | egység | 1 Hz |
| `pump_state` | 4 bit | változáskor |
| `head_facing_station` | állomásazonosító | változáskor (VR) |

### 7.2. Származtatott (futásonként)

**Követés.**
`tracking_rms(cond)` = a `track_error_deg` négyzetes átlagának gyöke az adott
feltételben, a blokk **első 5 másodpercének kihagyásával** (a kar felvétele nem
követési hiba).

**Rendszerfigyelés.**
`monitor_hit_rate(cond)` = helyes válaszok / események. Találat: a helyes
elemre adott válasz a 8 s-os ablakon belül.
`monitor_rt_median(cond)` = a találatok medián RT-je, a 150 ms alattiak
kizárásával (azok nem lehetnek az eseményre adott válaszok).
`monitor_false_alarms_per_min(cond)`.

**Erőforrás.**
`resource_deviation(cond)` = `mean(|szintA − 2500| + |szintB − 2500|) / 2`,
egységben.
`pump_recovery_lag_s` = a szivattyúhiba kezdetétől az első kompenzáló
kapcsolásig eltelt idő mediánja.

**Rádió.**
`audio_hit_rate(cond)` = saját hívójelre adott helyes csatornaválasztás /
saját hívások.
`comm_false_alarms` = idegen hívójelre adott válaszok száma.
`comm_rt_median(cond)`.

**A fő mutató.**
Minden állomásra a **normalizált költség**:

```
cost_track    = (rms_load_low − rms_baseline)      / rms_baseline
cost_monitor  = (hit_baseline − hit_load_low)      / hit_baseline
cost_resource = (dev_load_low − dev_baseline)      / dev_baseline
cost_comm     = (hitA_baseline − hitA_load_low)    / hitA_baseline
dual_task_cost = mean(a fenti négy, 0-ra vágva alul, 2,0-ra felül)
```

**Miért `load_low` és nem `load_high`.** A `baseline` és a `load_low` blokk
eseményrátái **pontosan megegyeznek** (5 rendszeresemény/perc, 4 hívás/perc,
1,5 szivattyúhiba/perc, 1,0 forgatóerősítés). A kettő között tehát az
*egyetlen* különbség az egyidejű feladatok száma — ez a dual-task cost
definíciója. A `load_high` az eseménysűrűséget is emeli, ezért az önálló
mutatóként szerepel:

```
overload_cost = (hit_load_low − hit_load_high) / hit_load_low
```

A felső vágás azért kell, mert egy közel hibátlan alapvonal (pl. `rms_baseline`
= 0,4°) melletti romlás aránya korlátlanul nagy lehet, és egyetlen állomás
elvinné az átlagot. A vágás ténye a naplóba kerül (`costClipped: true`).

**Terhelési meredekség.**
`load_slope` = a kompozit teljesítményindex (a négy állomás z-transzformált
teljesítményének átlaga) lineáris meredeksége az egyidejű feladatok száma
(1, 2, 4) szerint.
`overload_knee` = igaz, ha a 2 → 4 közti romlás nagyobb, mint az 1 → 2 közti
romlás kétszerese (a romlás nem lineáris, hanem összeomlik).

**Térbeli mutatók (VR-only).**
`station_dwell_entropy` = a négy állomáson töltött fejirány-idő normalizált
entrópiája (`normalisedEntropy`), 0 = egy állomást néz végig, 1 = egyenletes.
Az „állomáson” azt jelenti, hogy a fejirány és az állomás iránya közti szög
< 30°.
`neglect_time_s` = a leghosszabb összefüggő idő, amíg egy adott állomás felé
egyszer sem fordult, a `load` blokk alatt (a négy állomás maximuma).
`orientation_cost_ms` = a MONITOR események mediánja RT-jének különbsége
aszerint, hogy az onset pillanatában a MONITOR felé nézett-e (< 30°) vagy sem.
`rear_station_hit_rate` = a COMM (±138°) találati aránya.

**Egyéb.**
`tracking_idle_fraction` = az az arány a TRACK aktív idejéből, amikor a kar
kitérése < 0,05 volt legalább 1,5 s-ig egyfolytában — vagyis a követést
ideiglenesen elengedte.

### 7.3. Score (0–100) és horgonyok

| Score | Metrika | `good` | `poor` | Indoklás |
|---|---|---|---|---|
| `tracking_performance` | `tracking_rms(load)` | 1,4° | 6,5° | a MATB-II tipikus RMS-tartománya gyakorlott és kezdő között; **provizórikus**, VR-analóg karra kalibrálva |
| `monitoring_performance` | `monitor_hit_rate(load)` − FA-büntetés | 0,92 | 0,50 | 0,50 a véletlen körüli szint hat elemnél nem, de a „mindent megnyomok” stratégia FA-val bünteti |
| `resource_performance` | `resource_deviation(load)` | 220 e | 900 e | a 500 e-s sávszél a referencia; a fele jó, a duplája rossz |
| `comm_performance` | `audio_hit_rate(load)` − FA | 0,90 | 0,45 | 40%-os saját arány mellett a „mindig válaszolok” stratégia FA-ban bukik |
| `dual_task_resilience` | `1 − dual_task_cost` | 0,85 | 0,20 | a MATB-II irodalmában 15–60% romlás a tipikus tartomány; **becslés** |
| `attention_distribution` | `station_dwell_entropy` | 0,90 | 0,45 | 1,0 nem cél: a TRACK több figyelmet érdemel, mint a COMM |
| `orientation_efficiency` | `neglect_time_s` | 12 s | 55 s | 55 s alatt egy szivattyúhiba végigfut és két esemény lejár |

Minden horgony **provizórikus**, amíg nincs saját normaminta; a
`scoring_version` `1.0.0`, tehát később újraszámolható.

### 7.4. OPS SCORE összetevők

| Összetevő | Súly (VR) | Súly (sík) |
|---|---|---|
| `tracking_performance` | 0,20 | 0,24 |
| `monitoring_performance` | 0,18 | 0,22 |
| `resource_performance` | 0,14 | 0,17 |
| `comm_performance` | 0,14 | 0,17 |
| `dual_task_resilience` | 0,20 | 0,20 |
| `attention_distribution` | 0,08 | — |
| `orientation_efficiency` | 0,06 | — |
| **Összeg** | **1,00** | **1,00** |

**Tengelypontszámok a profilhoz:** `attention` = a monitoring, comm és
attention_distribution átlaga; `motor` = tracking_performance;
`executive` = dual_task_resilience.

---

## 8. ESEMÉNYNAPLÓ

| Eseménytípus | Payload |
|---|---|
| `multi_setup` | `platform`, `layout` (`surround`/`flat`), `stationAzDeg`, `commSide`, `commChannel`, `speechAvailable`, `quantisationMs`, `forcingFreqs`, `forcingPhases`, `callSign` |
| `phase_start` / `phase_end` | `condition`, `practice`, `activeStations[]`, `durationMs`, `eventRates`, `plannedEvents`, és a végén a szakasz összesítése. A `block_start`/`block_end` eseményt a `ModuleRunner` írja, ezért a modul saját neve `phase_*`. |
| `station_event` | `station`, `kind` (`light_off`/`light_on`/`scale_drift`/`pump_fail`/`call`), `element`, `t`, `ownCallSign?`, `channel?`, `snrDb?` |
| `station_response` | `station`, `element`, `kind`, `rtMs`, `onsetT`, `correct`, `condition`, `facingAtOnset`, `headFacingStation` |
| `station_timeout` | `station`, `element`, `kind`, `onsetT`, `windowMs`, `facingAtOnset` |
| `false_alarm` | `station`, `element`, `t`, `sinceLastEventMs` |
| `track_bin` | `rmsDeg`, `maxDeg`, `stickMean`, `binStartT`, `binMs` (1000) |
| `tank_sample` | `a`, `b`, `pumps` (4 bit), `t` |
| `pump_fail` / `pump_repair` | `pump`, `t` |
| `station_gaze` | `station`, `previous`, `offsetDeg`, `condition` — **csak VR**, a nézett állomás váltásakor |
| `calibration_done` | `callSign`, `commChannel`, `anchorHeight`, `anchorYawDeg` |
| `speech_unavailable` | `fallback: 'tones'` |
| `load_change` | `level`, `eventRates` — CHALLENGE módban |

**Mozgásnaplózás: 20 Hz.** Itt a fejirány **valódi metrika** (dwell entropy,
neglect time), nem melléktermék — az 5 Hz túl durva a 0,5–1,5 s-os
fordulások szegmentálásához, a 30 Hz viszont fölösleges adat, mert a fej
fordulási sávszélessége ennél alacsonyabb.

A `track_bin` szándékosan **aggregált**: a 20 Hz-es nyers hibajelet nem
küldjük fel (560 s × 20 Hz × 2 tengely ≈ 22 400 szám), a másodpercenkénti RMS
és maximum viszont minden későbbi elemzéshez elég, és a `motion_traces`
külön tartalmazza a fej- és kézpályát.

---

## 9. ADATBÁZIS

Nincs új tábla. A modul a meglévő sémát használja.

**`trials`** — a MULTI eseményvezérelt állomásainál egy „trial” egy esemény:

```json
stimulus: {
  "station": "monitor",
  "kind": "scale_drift",
  "element": "scale3",
  "condition": "load_high",
  "activeStations": ["track","monitor","resource","comm"],
  "eventRatePerMin": 10,
  "headFacingStation": "track",
  "headOffsetDeg": 71.4,
  "azDeg": -68
}
response: {
  "element": "scale3",
  "rtMs": 1840.2,
  "source": "right",
  "quantisationMs": 11.1,
  "stickMagnitudeAtResponse": 0.31
}
correct: true,  outcome: "hit",  reactionTimeMs: 1840.2
```

A folytonos állomások (TRACK, RESOURCE) **nem** hoznak létre trial sorokat;
azok a `metrics` és az `events` táblába kerülnek. Ez szándékos: egy trial a
sémában „egy inger — egy válasz”, és egy 140 s-os követési szakasz nem az.

**`metrics`** — a 7.2. minden származtatott metrikája, `scope` mezővel
(`baseline` / `dual` / `load_low` / `load_high` / `overall`).

**`runs.summary`** — a `commChannel`, a `spatialWeightsApplied`, a
`costClipped` és az elrendezés.

---

## 10. FELHASZNÁLÓI FOLYAMAT

**INTRO.**
> **MULTI — Többfeladatos terhelés**
> Négy állomás. Előbb egyesével, aztán mind egyszerre.
> Nem az a kérdés, hogy tökéletes vagy-e — hanem hogy mennyivel romlik az,
> amit egyedül jól csinálsz, amikor közben másra is figyelned kell.
> **12 perc.**

**INSTRUKCIÓ (állomásonként, a `baseline` blokk előtt).**
> **KÖVETÉS.** A korongot tartsd a gyűrű közepén a bal karral. Elsodródik —
> a te dolgod visszahúzni.
>
> **RENDSZER.** A zöld fénynek égnie kell, a pirosnak sötétnek. A négy skála
> mutatója középen ingadozik. Ha bármelyik eltér, koppints rá.
>
> **TARTÁLYOK.** A két tartály szintjét tartsd a zöld sávban a szivattyúkkal.
> A szivattyú néha elromlik — akkor a másikat kell használni.
>
> **RÁDIÓ.** A hívójeled: **KILO 4**. Ha ezt hallod, állítsd be a mondott
> csatornát. Ha más hívójelet hallasz, **ne csinálj semmit**.

**KALIBRÁCIÓ.**
1. Hívójel kiosztása és kétszeri lejátszása. A felhasználó megerősíti, hogy
   hallotta („Hallottam” gomb). Ha nem, hangerő-állítás.
2. A kar kalibrálása: „Húzd a kart mind a négy irányba ütközésig.” Ez rögzíti
   a tényleges kitérési tartományt és kiszűri a holtjátékot.
3. VR-ben: „Fordulj körbe egyszer, hogy lásd, hol van a négy állomás.” A
   modul rögzíti a testpozíciót (`BodyAnchor`), és az állomások ehhez kerülnek.

**GYAKORLÁS.** 4 × 15 s állomásonként visszajelzéssel, majd 30 s négyes
gyakorlás visszajelzés nélkül (hogy a mérés élménye ne érje meglepetésként).

**„MOST JÖN A MÉRÉS”.**
> Innentől nincs visszajelzés és nincs pontszám. Hét szakasz jön,
> szünet nélkül. Ha valamit elrontasz, ne állj meg miatta.

**MÉRÉS.** `baseline` → `dual` → `load` (alacsony) → `load` (magas).
Szakaszonként 6 s szünet és egy sor: „Következik: mind a négy állomás.”

**FELDOLGOZÁS.** „Költségek számítása…”

**EREDMÉNY** (kiemelt sorok):

| Sor | Példaérték | Magyarázó |
|---|---|---|
| Többfeladatos költség | **34%** | ennyivel romlott az átlagos teljesítményed terhelés alatt |
| Követés terhelés alatt | **2,8°** | egyedül 1,6° volt |
| Rendszerfigyelés | **81%** | 4 kihagyott esemény, 2 téves riasztás |
| Rádió | **76%** | zajban, a saját hívójeledre |
| Figyelemelosztás | **0,74** | egyenletesen osztottad el — *csak VR* |
| Leghosszabb elhanyagolás | **41 s** | ennyi ideig nem néztél a tartályokra — *csak VR* |

Sík platformon az utolsó két sor helyén ez áll:
> *A figyelemelosztás méréséhez VR szükséges — sík képernyőn mind a négy
> állomás egyszerre látszik, tehát nincs mit elosztani.*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Forrásparadigma.** NASA Multi-Attribute Task Battery II (Comstock &
Arnegard, 1992; a NASA nyilvánosan terjesztett változata). A négy alfeladat
(tracking, system monitoring, resource management, communications) neve,
logikája és nagyságrendjei onnan származnak.

**Amiben eltérünk, és miért.**

1. **Körülvevő elrendezés VR-ben.** A MATB-II négy panele egy monitoron
   van. Itt legfeljebb kettő látszik egyszerre. Ez **új konstruktumot tesz
   mérhetővé** (figyelemelosztás mint viselkedés), de azt is jelenti, hogy a
   VR-változat abszolút értékei **nem vethetők össze** a MATB-II
   szakirodalmi értékeivel. A sík változat igen — ez az egyik oka annak,
   hogy a sík platformot megtartottuk.
2. **Alapvonal-blokkok.** A MATB-II-t gyakran csak terhelt állapotban
   futtatják. Alapvonal nélkül a `dual_task_cost` nem számolható, ezért
   nálunk kötelező.
3. **Egyszerűsített erőforrás-alfeladat.** A MATB-II 6 tartályt és 8
   szivattyút használ; itt 2 tartály és 4 szivattyú van. A 8 szivattyús
   változat a betanulási időt 10 perc fölé tolná, ami egy felügyelet nélküli
   mérésnél nem vállalható.
4. **Kar helyett thumbstick.** A MATB-II joystickje folytonos; a Quest
   thumbstickje is az, de rövidebb úton — a `tracking_rms` abszolút értéke
   ezért nagyobb.

**Elvárt nagyságrendek egészséges felnőttnél** (becslés, kalibrálandó):

| Metrika | Alapvonal | Négyes terhelés |
|---|---|---|
| `tracking_rms` (VR) | 1,3–2,2° | 2,4–4,5° |
| `monitor_hit_rate` | 0,93–0,99 | 0,72–0,90 |
| `resource_deviation` | 130–300 e | 300–750 e |
| `audio_hit_rate` | 0,90–0,98 | 0,68–0,88 |
| `dual_task_cost` | — | 0,25–0,55 |
| `station_dwell_entropy` (VR) | — | 0,62–0,88 |
| `neglect_time_s` (VR) | — | 18–55 s |

**Amit ebből NEM szabad kikövetkeztetni.**
- Hogy valaki alkalmas-e pilótának, diszpécsernek vagy irányítónak.
- Hogy „jól bírja a stresszt”. A modul terhelést ad, nem stresszort: nincs
  tét, nincs következmény, nincs időnyomás a szó szoros értelmében.
- Hogy a többfeladatos teljesítménye a munkahelyén is ilyen lenne. A MATB-II
  absztrakt; a transzfert külön kell validálni.
- Egyetlen alacsony `station_dwell_entropy`-ból stratégiai hibát. Aki a
  követésre koncentrál a rádió rovására, **prioritást választott** — az
  eredményképernyő ezt így is fogalmazza.

**Tanulási hatás.** A MATB-II-nél a legerősebb tanulás az első 2–3 felvételen
történik, elsősorban az erőforrás-alfeladatban (a szivattyúlogika megértése).
Ismételt mérésnél:
- 2. felvétel: 10–20% javulás a legtöbb mutatóban, a `resource_deviation`-ben
  akár 35%.
- 5. felvétel: a görbe lelapul; a `dual_task_cost` stabilizálódik, és ez a
  legmegbízhatóbb ismételt mutató.
- **Új seed kötelező** minden felvételnél: az eseménysorrend megtanulása
  egyébként látszólagos javulást adna.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

| # | Állítás | Hogyan tesztelhető |
|---|---|---|
| 1 | Két azonos seedű futás azonos esemény-időpontokat és -típusokat ad mind a négy állomáson. | Két futás `station_event` naplójának összehasonlítása egységtesztben, hamis órával. |
| 2 | Egy `baseline` blokk minden állomásra pontosan 50 ± 0,5 s mérési időt ad. | A `block_start` és a blokkvég közti idő a naplóból. |
| 3 | Ha egy MONITOR eseményre nem érkezik válasz 8000 ms-on belül, a próba `timeout` kimenettel zárul. | Szimulált futás válasz nélkül; minden esemény `station_timeout`. |
| 4 | Eseményen kívüli megnyomás `false_alarm` eseményt ír, és nem számít találatnak. | Szimulált „mindent megnyomok” stratégia; `monitor_hit_rate` nem éri el az 1,0-t, az FA-szám > 0. |
| 5 | A `tracking_rms` a hiba ±12°-os vágása miatt akkor sem nő korlátlanul, ha a kar végig nulla. | Kar nélküli szimuláció; az RMS < 12,0 és véges. |
| 6 | A `dual_task_cost` mind a négy állomásra kiszámolható, és a `[0, 2]` tartományba esik. | Szintetikus futás ismert alapvonallal és ismert romlással; az érték az elvárt. |
| 7 | Sík platformon a `station_dwell_entropy`, `neglect_time_s`, `orientation_cost_ms`, `rear_station_hit_rate` **nem kerül a metrikák közé**. | Asztali és mobil futás metrikalistájának ellenőrzése. |
| 8 | Sík platformon az OPS-súlyok összege 1,00, és a `spatialWeightsApplied` értéke `false`. | Egységteszt a súlylistára mindkét ágon. |
| 9 | Ha a Web Speech API nem elérhető, a hívások hangkódolva mennek, és a futás `commChannel: 'tones'` értékkel rögzül. | A `speechSynthesis` kiütése a tesztkörnyezetben; a napló ellenőrzése. |
| 10 | Mobilon a virtuális kar folytonos 0–1 kitérést ad, és a `stick` sávja nem takarja el egyik állomáspanelt sem. | A `reportInset` értéke > 0, és a négy állomás középpontjának képernyő-y koordinátája az insetelt viewport fölött van. |
| 11 | A hívójel-arány a `load` blokkban 0,40 ± 0,05. | A `comm_call` események megszámolása egy 140 s-os blokkban. |
| 12 | A követés forgatófüggvénye nem periodikus 140 s-on belül. | Numerikus pásztázás 2–140 s között: nincs olyan T, amelynél mind a négy `f·T` egészhez közel esne. |
| 13 | A `load` blokk alatt a szivattyúhibák aránya megfelel a konfigurációnak ±20%-on belül. | 10 szimulált futás átlaga. |
| 14 | Kilépés a blokk közepén nem hagy futó időzítőt és nem dob hibát. | `abort()` hívása minden blokkfázisban; a konzol tiszta, a `dispose()` lefut. |

---

## 13. IMPLEMENTÁCIÓS JEGYZETEK

- **Egy állomás = egy osztály.** `TrackStation`, `MonitorStation`,
  `ResourceStation`, `CommStation`, közös `Station` interfésszel
  (`setActive`, `update(dt, t)`, `respond(element, t)`, `metrics()`).
  A blokkok csak azt mondják meg, melyik állomás aktív — a
  `baseline`/`dual`/`load` közti különbség így egyetlen halmaz.
- **Az eseménylista a blokk elején generálódik**, a seedből, nem menet közben.
  Ez teszi a futást reprodukálhatóvá, és ez az egyetlen módja, hogy egy
  hamis órás egységteszt ugyanazt a sorrendet lássa.
- **A követés integrálása a frame-időből megy**, `clock.frameTime` alapján, nem
  `dt` akkumulációból, mert egy elejtett frame egyébként hibát injektálna a
  mérésbe.
- **A `BodyAnchor` a kalibrációnál rögzül**, és minden állomás ahhoz képest kap
  irányt — nem a világ origójához.
- **A COMM panel a `station_gaze` szempontjából is állomás:** a fejirány-alapú
  dwell mind a négyre számol, különben a rádióra fordított idő „sehol” lenne.
