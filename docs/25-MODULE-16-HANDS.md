# 25 — MODUL 16 · HANDS · Finom manuális ügyesség

**Kód:** `HANDS` · **Sorszám:** 16 · **Verzió:** 0.1.0
**Konfiguráció:** `HANDS_STANDARD_A` (alap), `HANDS_SHORT` (rövid)
**Platform:** **csak VR.** Asztali és mobil böngészőben nem indul (lásd 5.)
**Paradigmák:** Purdue Pegboard (Tiffin, 1948), Grooved Pegboard (Matthews & Klove),
buzz-wire tracing, dimenziótlan normalizált jerk (Hogan & Sternad, 2009)
**Kapcsolódó dokumentumok:** `00-MASTER-SPEC.md` 5/16, `02-CROSSPLATFORM-INTERACTION.md` 2/C,
`03-SPATIAL-DESIGN.md` 2.4 és 2.5

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban.** A HANDS azt méri, **milyen gyorsan és milyen pontosan tud a
felhasználó apró elemeket megfogni, elforgatni, elhelyezni és szűk pályán
átvezetni** — egy kézzel, a másikkal, és két kézzel egyszerre.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Honnan |
|---|---|---|
| Manuális ügyesség | Elhelyezett elemek száma időegység alatt | Purdue Pegboard |
| Finommotoros pontosság | A behelyezés pillanatában mért sugárirányú hiba és szöghiba | Grooved Pegboard |
| Kétkezes koordináció | A két kéz egyidejű, egymástól független működtetésének hatékonysága | Purdue „both hands” és „assembly” alteszt |
| Fogásprecizitás | A megfogás és az elengedés helyzethibája, és a tartás alatti remegés | — |
| Mozgássimaság | Dimenziótlan normalizált jerk a szállítási szakaszokon | Hogan & Sternad |

### Amit a modul kifejezetten NEM mér

- **Nem méri a valódi tapintást és a fogóerőt.** A kontroller nem ad
  haptikus visszajelzést a megfogott tárgyról; a „fogás” egy ravaszhúzás.
  Ez a modul legfontosabb korlátja, és minden eredmény mellett szerepel.
- **Nem méri az izomerőt vagy a kitartást.** A blokkok rövidek.
- **Nem klinikai eszköz.** A Purdue és a Grooved Pegboard normáit
  **nem szabad** ideimportálni: azok fizikai pálcikákra és fizikai furatokra
  vonatkoznak, tapintással. Ez a modul saját normacsoportot igényel.
- **Nem alkalmassági vizsgálat** sebészi, fogorvosi vagy bármely más
  szakmára.
- **Nem méri a kézdominanciát.** Megfigyeli a két kéz teljesítménykülönbségét;
  hogy melyik a domináns, a felhasználó mondja meg a kalibrációnál.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**B — munka (`primary`).** A pegboard-típusú tesztek évtizedek óta a manuális
szakmák bevált szűrőeszközei. A VR-változat előnye nem az érvényesség
(az kevesebb), hanem az üzemeltetés: nincs eszközkopás, nincs kézi
stopperolás, nincs vizsgálatvezetői elfogultság, és a teljes mozgáspálya
rögzül, nem csak a végeredmény. A `path_jerk` és az `insertion_precision_mm`
olyan mutatók, amiket fizikai pegboarddal nem lehet felvenni.
*Munkakörök:* sebész, fogorvos, órás, elektronikai szerelő, fodrász, szakács,
laboratóriumi asszisztens.

**A — védelmi (`secondary`).** Szerelés, hibaelhárítás, kesztyűben végzett
finommunka. A kesztyű hatását a modul **nem** modellezi; a védelmi
felhasználásban ezért kiegészítő, nem elsődleges mutató.
*Munkakörök:* műszerész, tűzszerész-támogatás, híradó szerelő.

**C — sport (`secondary`).** A technikai sportágakban a mikromozgás minősége
dönt, de ott a *tartás* stabilitása fontosabb, mint az áthelyezés sebessége —
ezt a STEADY méri jobban. A HANDS itt kiegészítő.
*Sportágak:* sportlövészet, íjászat, biliárd, e-sport.

---

## 3. FELADATSTRUKTÚRA

### 3.1. Blokkok

| # | Blokk | Cél | Idő | Gyakorlás | `unitLabel` |
|---|---|---|---|---|---|
| 1 | `pegs` | Purdue-szerkezet: jobb kéz · bal kéz · két kéz | 3 × 30 s | 3 × 10 s | `kézbeosztás` |
| 2 | `grooved` | Kulcsos pálcika: forgatni kell, hogy beférjen | 60 s | 15 s | `menet` |
| 3 | `wire` | Gyűrű átvezetése hajlított pályán, érintés nélkül | 3 × ~25 s | 1 × 20 s | `pálya` |
| 4 | `assembly` | Négyelemű összeszerelés váltott kézzel | 60 s | 20 s | `menet` |

**Mérési idő:** 90 + 60 + 75 + 60 = 285 s. Átvezetésekkel, gyakorlással,
instrukcióval és eredménnyel kb. 6,5 perc.

`HANDS_SHORT`: `pegs` 3 × 20 s, `grooved` 40 s, `wire` 2 pálya, `assembly` 40 s
→ 180 s.

### 3.2. A trial anatómiája

A HANDS **folyamatos** feladatokból áll; egy „próba” egy **elhelyezés**:

```
PREPARE          a pálcika a tálcán, elérhető helyzetben
COUNTDOWN        nincs — a blokk indul, és fut, amíg le nem jár az idő
STIMULUS         a következő szabad furat kiemelése (halvány gyűrű)
RESPONSE WINDOW  a blokk hátralévő ideje
RESPONSE         megfogás → szállítás → behelyezés (elengedés a furatban)
FEEDBACK         gyakorlásban: a furat felvillan zölden vagy pirosan
INTER-TRIAL      nincs; a következő furat azonnal kiemelődik
```

Egy elhelyezés négy fázisra bomlik, és mind a négyet külön mérjük:

| Fázis | Kezdete | Vége | Amit mér |
|---|---|---|---|
| `reach` | az előző elengedés | a megfogás | eljutás a tálcához |
| `grasp` | a megfogás | az elmozdulás > 15 mm | a fogás megszervezése |
| `transport` | elmozdulás > 15 mm | a furat 30 mm-es környezete | **itt mérjük a jerk-et** |
| `place` | a furat közelítése | az elengedés | **itt mérjük a remegést és a pontosságot** |

Ez a felosztás Fitts logikáját követi: a szállítás ballisztikus, a behelyezés
zárt hurkú, és a kettő különböző képességet terhel. Egyben ez teszi
értelmezhetővé az eredményt: „lassú, de pontos” és „gyors, de sokat javít”
két különböző profil, azonos elhelyezés/perc mellett.

### 3.3. Számok blokkonként

| Paraméter | `pegs` | `grooved` | `wire` | `assembly` |
|---|---|---|---|---|
| Pálcika átmérő | 10 mm | 10 mm (kulccsal) | — | 8–26 mm |
| Furat sugártűrés | 9 mm | 9 mm | — | 10 mm |
| Szögtűrés | nincs | **±12°** | — | ±15° (gallér) |
| Furatok száma | 2 × 10 | 2 × 10 | — | 4 lépés egy oszlopon |
| Furattávolság | 34 mm | 34 mm | — | — |
| Gyűrű belső sugár | — | — | 22 mm | — |
| Drót sugara | — | — | 6 mm | — |
| Érintésküszöb | — | — | 16 mm-nél nagyobb tengelytávolság | — |
| Ívhossz (síni irány) | — | — | 4 × 0,16 m | — |
| Ívkitérés | — | — | 90 mm | — |

---

## 4. INGERDEFINÍCIÓ A PRIMITÍVKÖNYVTÁRBÓL

Külső asset nincs. Egy elem kivételével minden primitív: a drótpálya
`THREE.TubeGeometry`-vel készül a mintavett polyline mentén. Ez továbbra is
eljárásilag generált geometria, nem asset; a 120 hengerből álló lánc
ugyanezt adná, csak pazarlóan és szemmel láthatóan szakaszosan, a 6 mm-es
sugárnál pedig pont az érintési szabály olvashatósága romlana el.

| Elem | Geometria | Méret | Szín |
|---|---|---|---|
| Tábla | `box` | 0,40 × 0,26 × 0,012 m | `surfaceAlt` |
| Furat | `torus` | ø 20 mm, cső 2 mm | `textMuted` 45% |
| Aktív furat | `torus` | ugyanaz | `accent`, 1,4× vastag |
| Pálcika | `cylinder` | ø 10 mm × 46 mm | `accent2` |
| Kulcs (grooved) | `box` | 3 × 3 × 20 mm, a pálcika oldalán | `accent2` |
| Drót | eljárásilag generált cső (`TubeGeometry` a mintavett pálya mentén) | sugár 6 mm, 4 ív | `textMuted` |
| Gyűrű (wire) | `torus` | belső 22 mm, cső 5 mm | `accent` |
| Tengely (assembly) | `cylinder` | ø 8 mm × 60 mm | `accent2` |
| Alátét | `torus` | belső 9 mm, külső 20 mm | `text` |
| Gallér | `cylinder` | ø 26 mm × 14 mm, ø 9 mm furattal | `accent` |

### 4.1. Elhelyezés a karnyújtásnyi térben

Minden geometria a `BodyAnchor`-hoz képest van, **nem a világ origójához**.
A tábla középpontja: `anchor.offset(0, −0,34, 0,46)`, a lap normálisa
45°-kal a résztvevő szeme felé billentve. Ez két dolgot ad:

1. **A tábla nem egy sík a szem előtt, hanem egy asztal.** A közeli és a
   távoli furat 11 cm-rel különbözik távolságban, tehát a behelyezés
   mélységi ítéletet kíván — ezt kizárólag a diszparitás és a parallaxis
   hordozza.
2. **Elérhető.** A 0,46 m előre és 0,34 m lefelé eltolás a kényelmes
   manipulációs zóna közepe álló testhelyzetben.

A kalibráció rögzíti a testhelyzetet, és a tábla ott marad: egy fejhez
kötött tábla **nem megfogható**, mert hátrál, ahogy a felhasználó felé
hajol.

### 4.2. A drótpálya felépítése

Négy azonos hosszúságú és azonos görbületi sugarú ív, ívenként 0,16 m
sínirányú előrehaladással és 90 mm kitéréssel (teljes szélesség ±0,32 m,
tehát karnyújtáson belül):

```
L1  oldalirányú ív      (a mélység állandó)
D1  mélységi ív         (a résztvevő felé és vissza)
L2  oldalirányú ív      (tükrözve)
D2  mélységi ív         (tükrözve)
```

Az azonos hossz és görbület **szándékos**: a `depth_segment_cost` így
két olyan szakasz különbsége, amelyek csak az irányukban térnek el.
Ha a mélységi szakasz nehezebb, az nem a pálya nehézségéből jön.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

### 5.1. Besorolás — minden elem `vr-only`

| Feladatelem | Osztály | Miért |
|---|---|---|
| Megfogás és elhelyezés | `vr-only` | a szabad térben végzett kétkezes manipulációnak nincs 2D megfelelője |
| Kulcsos behelyezés | `vr-only` | a forgatás a csuklóé, nem egy csúszkáé |
| Drótpálya | `vr-only` | a pálya mélységben halad; egérrel csak a vetülete követhető |
| Összeszerelés | `vr-only` | két kéz, egyidejűleg, eltérő mélységben |

**A `supports` mező ezért `['vr']`, és ez nem mulasztás.**

Egy egérrel húzott pálcika nem ugyanazt méri: a mozgás felbontása a
képernyő pixelrácsa, a `path_jerk` egy egérérzékenységi beállítás
függvénye lenne, és a „kétkezes koordináció” egy kézzel értelmezhetetlen.
A `03-SPATIAL-DESIGN.md` 4. fejezete szerint ilyenkor a mérés **hiányzik**,
nem közelítjük.

### 5/A. Amit a nem-VR felhasználó lát

A kezdőtér és a mobil alkalmazás a modulkártyán megjeleníti:

> **Ehhez a modulhoz VR headset kell.**
> A finom kézügyesség mérése a kéz valódi térbeli mozgásából származik.
> Egérrel vagy ujjal ugyanez a feladat egy másik képességet mérne, ezért
> nem kínálunk belőle leromlott változatot.

Az `INDÍTÁS` gomb letiltva, a magyarázat mellette. **Nem** indul csendben
egy egyszerűsített verzió.

### 5.2. Kontroller és kézkövetés

A modul mindkét beviteli módot támogatja, de **nem keveri őket**:

| | kontroller | kézkövetés (hand tracking) |
|---|---|---|
| Fogás | ravasz | csippentés (pinch) |
| Kézpozíció | grip space | csuklópóz |
| Érvényesség | kisebb: a fogás nem a kézé, hanem a ravaszé | nagyobb: valódi ujjmozgás |
| `comparability` | `vr:quest3:controller` | `vr:quest3:hands` |
| Remegésmutató | a kontroller remegése | a kéz remegése |

**A két mód eredménye soha nem kerül egy normacsoportba.** A `inputMode`
mező a futáson, a `comparability` kulcs pedig a ranglistán különíti el
őket. Az első verzió a kontrolleres módot valósítja meg; a kézkövetéses
mód ugyanezt az adatmodellt használja.

### 5.3. `controlHint`

| Platform | Szöveg |
|---|---|
| VR (kontroller) | `RAVASZ: fogás · engedd el a furat fölött` |
| VR (kéz) | `CSIPPENTÉS: fogás · nyisd ki a kezed a furat fölött` |
| asztali / mobil | *nem fut* |

---

## 5/B. MOBIL VEZÉRLŐKÉSZLET

**Nincs.** Ez a modul mobilon nem fut, tehát nem deklarál vezérlőt.

A `MobileControls` réteg egyetlen szerepe itt az, hogy a modulkártya
letiltott állapotát és a magyarázatot **ne** takarja el egy vezérlősáv —
amit a `ModuleRunner.setState()` már biztosít azzal, hogy minden nem futó
állapotban törli a réteget.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Mi teszi nehezebbé.** A furat sugártűrése, a szögtűrés, a furattávolság,
a drótgyűrű és a drót sugarának különbsége (a „rés”), és az összeszerelés
elemszáma.

### `HANDS_STANDARD_A`

```
pegSeconds            30   (jobb / bal / két kéz)
groovedSeconds        60
wirePaths             3
assemblySeconds       60
pegDiameterMm         10
holeToleranceMm       9
holeSpacingMm         34
groovedAngleToleranceDeg  12
ringInnerMm           22
wireRadiusMm          6
contactThresholdMm    16
boardForwardM         0.46
boardDownM            0.34
boardTiltDeg          45
grabRadiusMm          70
```

### `HANDS_SHORT`

```
pegSeconds            20
groovedSeconds        40
wirePaths             2
assemblySeconds       40
minden egyéb          azonos
```

### CHALLENGE mód

A furattűrés a teljesítményhez igazodik: három hibátlan elhelyezés után
1 mm-rel szűkül, egy elrontott után 1 mm-rel tágul (3-lefelé-1-felfelé,
mint a FIELD lépcsője). Élő pontszám látszik. **Az eredmény nem kerül
assessment normacsoportba**, mert a tűrés futásonként más.

---

## 7. METRIKÁK

### 7.1. Nyers (elhelyezésenként)

| Név | Egység |
|---|---|
| `hand` | `left` / `right` |
| `reach_ms`, `grasp_ms`, `transport_ms`, `place_ms` | ms |
| `insertion_error_mm` | mm — a furat tengelyétől mért sugárirányú távolság elengedéskor |
| `orientation_error_deg` | fok — csak `grooved` és `assembly` |
| `path_length_mm` | mm — a ténylegesen megtett út a szállítási fázisban |
| `straight_line_mm` | mm — a fogás és a furat közti egyenes |
| `normalised_jerk` | dimenziótlan |
| `hold_tremor_mm` | mm — a `place` fázis pozíciószórása |
| `drops` | 0/1 — elengedés a furaton kívül |

Emellett a kéz pozícióját **200 Hz-ig, a jelenetgráfból közvetlenül**
mintavételezzük a szállítási és behelyezési fázisban. Az
`input.pose()` 1 mm-re kerekít, a remegés viszont 0,3–1,2 mm — ugyanaz a
probléma, amit a STEADY-nél már megoldottunk, és ugyanaz a megoldás.

### 7.2. Származtatott (futásonként)

**Sebesség.**
`placements_per_min` = az elhelyezések száma percre vetítve, a `pegs` blokk
egykezes szakaszainak átlagából.
`placements_right`, `placements_left`, `placements_bimanual` külön.

**Kétkezesség.**
```
bimanual_asymmetry  = |right − left| / ((right + left) / 2)
bimanual_efficiency = bimanual_pairs_per_min / min(right, left)
```
A Purdue „both hands” alteszt tipikusan a gyengébb kéz üteme alatt marad;
az `efficiency` 1,0 fölött azt jelenti, hogy a két kéz párhuzamosítása
tényleg működik, nem felváltva dolgoznak.

**Pontosság.**
`insertion_precision_mm` = az `insertion_error_mm` **mediánja** (nem átlaga:
egyetlen elejtés különben elvinné).
`orientation_error_deg` = a `grooved` blokk szöghibáinak mediánja.
`drop_rate` = az elengedések aránya, amelyek nem a furatban végződtek.

**Simaság.**
`path_jerk` = a dimenziótlan normalizált jerk mediánja a szállítási
fázisokon:

```
NJ = sqrt( 0,5 · ∫|d³x/dt³|² dt · T⁵ / L² )
```

ahol `T` a szakasz hossza másodpercben és `L` a megtett út. Ez a mennyiség
független a sebességtől és a távolságtól, tehát két különböző hosszúságú
mozdulat simasága összehasonlítható.

**A referenciaérték nem nulla.** Egy analitikus minimum-jerk nyúlás értéke
pontosan `sqrt(360) = 18,97`, függetlenül attól, milyen messzire és milyen
gyorsan ment. Ez a skála alja: az ennél kisebb érték numerikus műtermék, nem
simább mozgás. A korrekciókkal tarkított, szakaszos mozdulat 60–300 közé esik.

**Numerikus megvalósítás.** A harmadik derivált a legérzékenyebb mennyiség,
amit ez a rendszer számol, és egy naiv centrális differencia **rendszeresen
alábecsli**: a minimum-jerk pálya a *végpontokon* hordozza a legnagyobb
jerk-et, a centrális séma viszont pont ott nem tud értéket adni. A mért érték
így a mintaszámtól függött volna (90 Hz-en 16,6, 45 mintán 14,7 a 18,97
helyett) — azaz a Quest képfrissítésétől. A megvalósítás ezért másodrendű
centrális sémát használ belül, és **egyoldali sémát a négy szélső pontban**,
majd trapéz szabállyal integrál a teljes szakaszon. Így 60 Hz és 240 Hz
között az eltérés az analitikus értéktől 1,5% alatt marad.

`path_efficiency` = `straight_line_mm / path_length_mm`, 0–1.

**Kontroll (drótpálya).**
`wall_contacts` = az érintések száma az összes pályán.
`wire_contact_time_ms` = az érintésben töltött összidő.
`wire_speed_mm_s` = a pálya menti haladás átlagsebessége.
`wire_depth_segment_cost` = a mélységi ívek érintési aránya mínusz az
oldalirányú ívek érintési aránya. **Ez a modul második térbeli mutatója**,
és sík platformon nem létezik — de mivel a modul csak VR-ben fut, itt nincs
mit átskálázni.

**Forgatás.**
`grooved_penalty` = `1 − (grooved_placements_per_min / plain_placements_per_min)`.
A Grooved Pegboard szakirodalmi lassulása a sima változathoz képest
jellemzően 2–3-szoros; a mutató 0,5–0,7 körül várható.

**Remegés.**
`hold_tremor_mm` = a `place` fázisokban mért maradék pozíciószórás mediánja,
miután egy 250 ms-os mozgóátlagot levontunk. A levonás a 4 Hz alatti
komponenst szűri ki: a furat felé tartó lassú sodródás **célzás**, nem
remegés, és nem szabad annak számolni. Csak azokat a mintákat használjuk,
amelyeknek mindkét oldalon teljes ablakuk van — a szakasz szélén a
féloldalas ablak miatt a sodródás beszivárogna a mutatóba.

### 7.3. Score (0–100) és horgonyok

| Score | Metrika | `good` | `poor` | Indoklás |
|---|---|---|---|---|
| `dexterity_rate` | `placements_per_min` | 34 | 12 | fizikai Purdue-n 15–20 pálcika / 30 s; VR-ben a hiányzó tapintás miatt lassabb — **becslés**, kalibrálandó |
| `placement_precision` | `insertion_precision_mm` | 2,2 mm | 7,5 mm | a 9 mm-es tűrés fele már „középre talált” |
| `movement_smoothness` | `path_jerk` | 24 | 80 | a minimum-jerk referencia 18,97; a `good` ennek 1,25-szöröse, a `poor` a szakaszos, korrekciós mozdulat tartománya — **becslés** |
| `path_control` | `wall_contacts` (3 pályán) | 2 | 18 | 0 érintés ritka, 18 fölött a gyűrű gyakorlatilag végig súrol |
| `bimanual_coordination` | `bimanual_efficiency` | 1,05 | 0,55 | a Purdue „both hands” tipikus aránya |
| `rotation_handling` | `grooved_penalty` | 0,35 | 0,75 | a kulcsos változat mindig lassabb; a kérdés, mennyivel |

Minden horgony **provizórikus.** A fizikai pegboard normáit tilos
átemelni: más eszköz, más érzékelés, más idő.

### 7.4. OPS SCORE összetevők

| Összetevő | Súly |
|---|---|
| `dexterity_rate` | 0,26 |
| `placement_precision` | 0,20 |
| `movement_smoothness` | 0,16 |
| `path_control` | 0,16 |
| `bimanual_coordination` | 0,14 |
| `rotation_handling` | 0,08 |
| **Összeg** | **1,00** |

Nincs sík ág: a modul csak VR-ben fut, tehát a `spatialWeightsApplied`
mindig `true`.

**Tengelypontszámok:** `motor` = a dexterity, precision és smoothness
átlaga; `spatial` = a rotation_handling és a path_control átlaga.

---

## 8. ESEMÉNYNAPLÓ

| Eseménytípus | Payload |
|---|---|
| `hands_setup` | `inputMode`, `dominantHand`, `boardOriginM`, `boardTiltDeg`, `pegDiameterMm`, `holeToleranceMm`, `holeSpacingMm`, `ringInnerMm`, `wireRadiusMm`, `quantisationMs`, `sampleHz` |
| `phase_start` / `phase_end` | `blockId`, `subBlock`, `hands[]`, `durationMs`, összesítés |
| `grab` | `hand`, `object`, `t`, `positionMm`, `distanceFromObjectMm` |
| `release` | `hand`, `object`, `t`, `inSocket`, `socket`, `errorMm`, `orientationErrorDeg` |
| `placement` | `hand`, `index`, `reachMs`, `graspMs`, `transportMs`, `placeMs`, `errorMm`, `orientationErrorDeg`, `pathLengthMm`, `straightLineMm`, `normalisedJerk`, `holdTremorMm`, `holeDepthM` |
| `drop` | `hand`, `object`, `t`, `nearestSocketMm` |
| `wire_contact` | `pathIndex`, `segment` (`lateral`/`depth`), `enterT`, `durationMs`, `axialDistanceMm` |
| `wire_run` | `pathIndex`, `completed`, `durationMs`, `contacts`, `contactMs`, `meanSpeedMmS`, `bySegment` |
| `assembly_part` | `part` (`pin`/`washer`/`collar`), `hand`, `expectedHand`, `rtMs`, `correctHand` |
| `hand_sample` | tömörített, 60 Hz: `hand`, `t`, `p[3]` — csak a `transport` és `place` fázisban |

**Mozgásnaplózás: 60 Hz** a `motion_traces` táblába, és **200 Hz-ig
belső mintavétel** a jerk- és remegésszámításhoz, amit **nem** töltünk fel
nyersen. A jerk harmadik derivált: 10 Hz-en zaj, 30 Hz-en még torzított.
60 Hz a legkisebb frekvencia, amin a Hogan–Sternad-mutató stabil, és
a Quest 3 kontrollerpóza ennél gyorsabban úgysem frissül.

---

## 9. ADATBÁZIS

Nincs új tábla.

**`trials`** — egy sor egy elhelyezés:

```json
stimulus: {
  "block": "grooved",
  "hand": "right",
  "socketIndex": 4,
  "holeDistanceM": 0.512,
  "holeElevationDeg": -21.4,
  "toleranceMm": 9,
  "angleToleranceDeg": 12
}
response: {
  "errorMm": 3.4,
  "orientationErrorDeg": 7.1,
  "reachMs": 420, "graspMs": 310, "transportMs": 640, "placeMs": 780,
  "pathLengthMm": 388, "straightLineMm": 301,
  "normalisedJerk": 17.4, "holdTremorMm": 0.62
}
correct: true, outcome: "hit", reactionTimeMs: 2150
```

A `wire` blokk pályánként egy sort ír (`outcome: "hit"` ha végigért,
`"miss"` ha feladta), az `assembly` alkatrészenként egyet.

---

## 10. FELHASZNÁLÓI FOLYAMAT

**INTRO.**
> **HANDS — Finom kézügyesség**
> Pálcikák, egy hajlított pálya és egy összeszerelés. Nem erő kell hozzá,
> és nem is sietség — pontosság.
> **Ehhez a modulhoz VR headset kell.** · **6–7 perc**

**INSTRUKCIÓ (blokkonként).**
> **PÁLCIKÁK.** A tálcáról vedd fel a pálcikát a ravasszal, és engedd el a
> kivilágított furat fölött. Előbb a jobb kezeddel, aztán a ballal, végül
> mindkettővel egyszerre. Ne siess jobban, mint amennyire pontos tudsz maradni.
>
> **KULCSOS PÁLCIKÁK.** Ugyanez, de a pálcika oldalán van egy bordázat, és
> a furatban egy horony. El kell forgatnod, hogy beférjen.
>
> **PÁLYA.** Fogd meg a gyűrűt, és vidd végig a dróton úgy, hogy ne érjen
> hozzá. Ha hozzáér, hangot ad — nem kell újrakezdened, csak menj tovább.
>
> **ÖSSZESZERELÉS.** Tengely a JOBB kézzel, alátét a BALLAL, gallér a
> JOBBAL, alátét a BALLAL. Aztán újra. A két kezed párhuzamosan dolgozhat.

**KALIBRÁCIÓ.**
1. „Melyik a domináns kezed?” — két gomb (BAL / JOBB). Ez sorrendet szab:
   a `pegs` blokk a dominánssal kezd.
2. „Állj kényelmesen, és tartsd a kezed ott, ahol dolgozni szoktál. Nyomd
   meg a ravaszt.” — ez rögzíti a `BodyAnchor`-t, és a táblát oda teszi.
3. Egy próbafogás: egy pálcika megfogása és elengedése, visszajelzéssel,
   hogy a fogási sugár érthető legyen.

**GYAKORLÁS.** Blokkonként a fenti táblázat szerint, visszajelzéssel.

**„MOST JÖN A MÉRÉS”.**
> Innentől nincs visszajelzés. Ha elejtesz egy pálcikát, hagyd ott, és
> vedd a következőt — az elejtés is adat.

**EREDMÉNY** (kiemelt sorok):

| Sor | Példaérték | Magyarázó |
|---|---|---|
| Elhelyezés | **26 / perc** | jobb 28, bal 24 |
| Pontosság | **3,1 mm** | a furat közepétől, medián |
| Mozgássimaság | **18** | dimenziótlan jerk — alacsonyabb a simább |
| Pályaérintés | **6** | három pályán összesen |
| Kétkezes hatékonyság | **0,88** | a két kéz párhuzamosítása |
| Forgatási költség | **0,52** | ennyivel lassabb a kulcsos pálcika |

Az eredményképernyő alján állandó megjegyzés:
> *A mérés kontrollerrel készült, tapintás nélkül. A fizikai pegboard
> normái ide nem érvényesek.*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Forrásparadigmák.** Purdue Pegboard (a jobb / bal / két kéz szerkezete és
az „assembly” alteszt logikája), Grooved Pegboard (a kulcsos behelyezés),
buzz-wire tracing (a pályakontroll), és a dimenziótlan normalizált jerk
(Hogan & Sternad, 2009) mint a mozgássimaság standard mérőszáma.

**Amiben eltérünk, és miért.**

1. **Nincs tapintás.** Ez a legnagyobb eltérés, és nem kompenzálható. A
   fizikai pegboardon a behelyezés utolsó milliméterét az ujjbegy vezeti;
   VR-ben ezt a szem végzi. A VR-változat ezért **részben vizuomotoros**
   feladat, és ezt minden eredmény mellett kimondjuk.
2. **A fogás bináris.** A ravasz nincs vagy van; a fogóerő fokozatai
   kiesnek. A kézkövetéses mód ezen javít, de nem szünteti meg.
3. **Idő-, nem darabszám-alapú blokk.** A Purdue 30 s alatt megszámolja a
   pálcikákat; ezt megtartottuk. A `grooved` viszont az eredetiben
   25 furatig tart — nálunk 60 s, mert egy felügyelet nélküli mérésnél a
   nyitott végű blokk kockázatos.
4. **A drótpálya nem Purdue-elem.** Azért került be, mert a
   `path_jerk`-hez folyamatos, kényszerített pálya kell; egy szabad
   nyúlásnál a simaság nagyrészt a választott útvonalé.

**Elvárt nagyságrendek (becslés, kalibrálandó):**

| Metrika | Tartomány |
|---|---|
| `placements_per_min` | 18–34 |
| `insertion_precision_mm` | 1,8–5,5 mm |
| `path_jerk` | 20–70 |
| `wall_contacts` (3 pálya) | 2–20 |
| `bimanual_efficiency` | 0,7–1,05 |
| `grooved_penalty` | 0,40–0,70 |
| `hold_tremor_mm` | 0,4–1,6 mm |

**Amit ebből NEM szabad kikövetkeztetni.**
- Hogy valaki alkalmas-e sebésznek, fogorvosnak vagy órásnak.
- Hogy a fizikai eszközökkel végzett munkája is ilyen lenne. A tapintás
  hiánya miatt a transzfer **nem bizonyított**.
- Neurológiai állapotot. A remegés és a jerk klinikailag érzékeny
  mutatók, de ez a modul nem diagnosztikai eszköz, és nem is szűrő.
  Feltűnő érték esetén az eredményképernyő **nem** ír semmit — az
  értelmezés orvosi kompetencia.

**Tanulási hatás.** A pegboard-típusú feladatok erősen tanulhatók:
- 2. felvétel: 10–18% javulás, elsősorban a `reach` és `grasp` fázisban.
- 5. felvétel: a sebesség platózik, a `path_jerk` és az
  `insertion_precision_mm` tovább javul — ezek a stabilabb mutatók.
- Az elrendezés (furatsorrend) futásonként új seedet kap.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

| # | Állítás | Hogyan tesztelhető |
|---|---|---|
| 1 | Két azonos seedű futás azonos furatsorrendet és azonos kulcsszögeket ad. | Két modul példány, ugyanaz a seed; a generált sorozatok összehasonlítása. |
| 2 | Egy `pegs` alszakasz pontosan 30 ± 0,5 s. | A `phase_start` / `phase_end` időbélyegek. |
| 3 | Az elengedés a furat 9 mm-es tűrésén kívül `drop` eseményt ír, és nem növeli az elhelyezésszámot. | Szintetikus elengedés 12 mm-re; a számláló nem nő, a `drop` esemény megvan. |
| 4 | A `grooved` blokkban a ±12°-on kívüli szög nem enged behelyezést. | Szintetikus elengedés 20°-os hibával; `drop`, nem `placement`. |
| 5 | A dimenziótlan jerk egy analitikus minimum-jerk pályára 18,97 ± 5% értéket ad, 60 Hz és 240 Hz között egyaránt. | Szintetikus minimum-jerk profil betáplálása több mintavételi rátán. |
| 6 | Ugyanaz a pálya kétszeres sebességgel és kétszeres távolsággal is ugyanazt a jerk-értéket adja. | Ugyanaz a profil `T`/`T/2` és `L`/`2L` mellett; az eltérés < 5%. |
| 7 | A `bimanual_efficiency` a gyengébb kézhez viszonyít, nem az átlaghoz. | Ismert bal/jobb/kétkezes ütemek; az eredmény az elvárt hányados. |
| 8 | A drótpálya mélységi és oldalirányú ívei azonos hosszúak ±2%-on belül. | A generált polyline szakaszhosszainak összevetése. |
| 15 | A megfogott tárgy helyzete az elengedés pillanatában az **aznapi** kézpózból származik, nem az előző frame-éből. | Szintetikus fogás-szállítás-elengedés: a 3 mm-re elengedett pálcika 3 mm hibát ad, nem egy frame-nyi kézmozgással többet. |
| 16 | A szögtűrésen kívüli elengedés akkor is elutasított, ha a pozíció tökéletes — és a napló tartalmazza az elutasító szöget. | Pozícióban 1 mm, szögben 30°: `drop`, `orientationErrorDeg` ≈ 30. |
| 9 | A modul asztali és mobil platformon **nem indul**, és magyarázatot ír ki. | `isRunnableOn(manifest, 'desktop' \| 'mobile')` hamis; a kártya letiltott. |
| 10 | A kézpozíciót a jelenetgráfból olvassuk, nem az `input.pose()`-ból (ami mm-re kerekít). | Kódszintű ellenőrzés + egy 0,4 mm-es szintetikus remegés visszanyerése. |
| 11 | Az `insertion_precision_mm` mediánt számol, tehát egyetlen kiugró elejtés nem viszi el. | 9 jó és 1 rossz elhelyezés; a medián a jókkal marad. |
| 12 | A `grooved_penalty` 0 és 1 közé esik, és NaN, ha a sima ütem hiányzik. | Hiányos futás betáplálása. |
| 13 | Kilépés egy blokk közepén nem hagy megfogott objektumot a kézhez ragadva. | `abort()` grab közben; a jelenet takarítása ellenőrizve. |
| 14 | A `comparability` kulcs kontrollernél és kézkövetésnél különbözik. | A futásrekord mezőjének ellenőrzése mindkét módban. |
