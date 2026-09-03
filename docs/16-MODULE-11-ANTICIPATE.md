# 16 — MODUL 11: ANTICIPATE
## Időzítés & előrejelzés — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/anticipate/AnticipateModule.ts`
**Támogatott platformok:** VR · asztali · mobil
**Névleges időtartam:** ~7 perc
**Doménkötés:** C elsődleges · B elsődleges · A másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** az ANTICIPATE azt méri, mennyire pontosan tudja valaki
**előre** megmondani, mikor ér célba egy mozgó tárgy — akkor is, amikor a
tárgy az utolsó szakaszon már nem látható.

### A modul tudományos gerince: nem reakció, hanem előrejelzés

Ez a modul nem reakcióidőt mér, és ez a legfontosabb dolog, amit meg kell
érteni róla. A reakcióidő-feladatban az inger megjelenik, és utána reagálunk —
a minimum, amit el lehet érni, a saját idegrendszeri késés. Itt a mozgás
**végig látható előre**, tehát a válasz időzíthető úgy, hogy pontosan
egybeessen az érkezéssel. A hiba lehet **negatív** (túl korai) is.

Ez azért számít, mert a sportban a reakcióidő ritkán a szűk keresztmetszet.
Egy 130 km/h-s tenisz-adogatásnál a labda 500 ms alatt ér oda; ha valaki
megvárná, amíg lát, már késő lenne. Az elit teljesítmény az előrejelzésből
származik, nem a gyorsabb reagálásból.

### A három klasszikus hibamutató

A koincidencia-időzítés irodalma három, egymástól független mutatót
használ, és a modul mindhármat külön adja meg — mert **mást jelentenek**:

| Mutató | Definíció | Mit jelent |
|---|---|---|
| **Konstans hiba (CE)** | az előjeles hibák átlaga | **Torzítás.** Rendszeresen siet vagy késik. Ez tanítható: egyszerű visszajelzéssel korrigálható. |
| **Variábilis hiba (VE)** | az előjeles hibák szórása | **Pontosság.** Mennyire konzisztens. Ez a nehezen javítható, és **ez a legjobb egyetlen tehetségmutató**. |
| **Abszolút hiba (AE)** | a hibák abszolút értékének átlaga | Összesített teljesítmény; a fenti kettő keveréke. |

Két sportoló azonos AE-vel gyökeresen különbözhet: az egyiknek nagy CE-je és
kis VE-je van (mindig 80 ms-mal siet — egy hét alatt korrigálható),
a másiknak nulla CE-je és nagy VE-je (átlagban jó, de kiszámíthatatlan —
ez a nehezebb eset). **Kiválasztásnál a VE a fontosabb szám.**

### Miért van takarás (okklúzió)

A látható pályán végigkövethető tárgy időzítése nagyrészt folyamatos
vizuomotoros szabályozás. A valóság nem ilyen: az ütő mögé kerülő labdát,
a kéz által takart ütőt, a peremen túli mozgást nem látjuk végig.
Az **időbeli okklúzió** — a pálya utolsó szakaszának elrejtése — kényszeríti
ki a valódi extrapolációt.

A hiba növekedése az okklúzió hosszával (`occlusion_robustness`) azt méri,
mennyire tudja valaki a belső mozgásmodellt fenntartani vizuális
megerősítés nélkül. Ez az a képesség, ami az ütősportokban elkülöníti a
szinteket.

### Az 5. blokk: a konstans sebesség feltevése

Az emberek a takarás alatt jellemzően **egyenletes sebességet** feltételeznek.
A valóságban a labda lassul (légellenállás), pattanás után irányt és sebességet
vált, és a szél elviszi. Az 5. blokkban a tárgy a takarás alatt **gyorsul vagy
lassul**. Aki vakon extrapolál, itt rendszeres hibát vét; aki figyelembe veszi
a takarás előtti sebességváltozást, kevésbé.

### Mért konstruktumok

| Konstruktum | Blokk | Paradigma |
|---|---|---|
| Koincidencia-időzítés | 1–5 | Coincidence-anticipation timing |
| Ütközési idő becslése | 2–5 | Time-to-contact / prediction motion |
| Mozgás-extrapoláció | 2–5 | Temporal occlusion |
| Sebesség-megkülönböztetés | 4 | Velocity scaling |
| Időbeli előrejelzés | 1–5 | — |
| Konstans sebesség feltevése | 5 | Accelerated occlusion |

### Amit a modul NEM mér

- **Nem reakcióidő.** Aki reagálni próbál a becsapódásra ahelyett, hogy
  előre időzítene, rendszeresen 200–300 ms-mal késik. A modul ezt fel is
  ismeri (nagy pozitív CE + a látható blokkban is nagy hiba), és az
  eredmény jelzi.
- **Nem méri a valódi labdakövetést.** Nincs benne parallaxis, forgás,
  légellenállás, és a tárgy egy egyszerű gömb.
- **Nem mond sportágat.** A jó időzítés több sportágban is előny;
  a sportági javaslat több modul profiljából származik, sosem ebből egyedül.
- **Nem szemkövetés.** A Quest 3 nem ad tekintetadatot. Hogy a résztvevő
  követte-e szemmel a tárgyat vagy előrenézett a becsapódási pontra
  (a szakértői mintázat), **nem mérhető** — a fejirány csak durva közelítés.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** Az ütő-, dobó- és elkapósportok legfontosabb
percepciós képessége. A takarásos változat pontosan azt méri, amit a valóság
kikényszerít: a labda utolsó szakaszát a játékos már nem látja. Az utánpótlás-
szűrésben a VE az egyik legjobban diszkrimináló egyszerű mutató.
Sportágak: teniszfogadás, baseball, krikett, asztalitenisz, röplabda, kapusposzt.

**B — Munkaalkalmasság (elsődleges).** A féktávolság- és előzésbecslés
percepciós magja. Az ütközési idő (time-to-contact) becslése a közúti
balesetkutatásban jól dokumentált kockázati tényező, és daru-, targonca-
és vasúti forgalmi munkakörökben közvetlenül releváns.
Munkakörök: hivatásos gépjárművezető, darukezelő, targoncás, vasúti forgalmi szolgálattevő.

**A — Védelmi (másodlagos).** Mozgó cél előretartása, konvojtávolság
tartása, járműtávolság-becslés.

---

## 3. FELADATSTRUKTÚRA

Alapelrendezés minden blokkban azonos: egy gömb balról vagy jobbról indul
egy vízszintes sínen, egyenletesen halad egy **jelölt célsík** felé, és a
feladat pontosan akkor válaszolni, amikor a gömb elérné a célt.

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | LÁTHATÓ | 5 | 16 | ~1:10 | alapvonal, folyamatos szabályozással |
| 2 | RÖVID TAKARÁS | 3 | 20 | ~1:30 | extrapoláció rövid vakon |
| 3 | HOSSZÚ TAKARÁS | 3 | 20 | ~1:30 | extrapoláció hosszú vakon |
| 4 | SEBESSÉG | 3 | 24 | ~1:40 | sebesség szerinti skálázás |
| 5 | VÁLTOZÓ SEBESSÉG | 3 | 16 | ~1:10 | a konstans sebesség feltevése |

### 3.1. A próba anatómiája

```
PREPARE          900–1600 ms   a sín és a célsík látszik, a gömb még nem
COUNTDOWN        0
STIMULUS         a menetidő + 1200 ms tűrés
                 - a gömb elindul, egyenletesen halad
                 - a takarási ponttól (ha van) láthatatlanná válik
                 - a válasz bármikor elfogadható az indulástól
RESPONSE         0
FEEDBACK         900 ms gyakorláskor (előjeles hibával), 0 mérés közben
INTER-TRIAL      500 ms
```

**Menetidő:** 1100–2200 ms között, blokktól függően. Ennél rövidebb idő
alatt nem alakul ki érdemi sebességbecslés; hosszabbnál a figyelem elkalandozik.

**Nagyon korai válasz.** A menetidő 25%-a előtti válasz `invalid`: a
résztvevő nem időzített, hanem elsütötte. Ilyenkor a próba megismétlődik a
blokk végén, legfeljebb háromszor.

**Nagyon késői válasz.** Az érkezés után 1200 ms-mal a próba `timeout`.

### 3.2. Blokk 1 — Látható

A gömb a teljes pályán látszik. Menetidő 1400–2000 ms, indulási oldal
véletlen, cél mindig a látómező közepe.

Ez az alapvonal: aki itt is nagy hibát vét, annál a probléma nem az
extrapoláció, hanem az időzítés maga — és a további blokkok eredménye
ennek fényében értelmezendő.

### 3.3. Blokk 2 — Rövid takarás

A gömb a pálya **70%-ánál eltűnik**, tehát az utolsó 30%-ot vakon kell
extrapolálni. Menetidő 1400–2000 ms, tehát a vak szakasz 420–600 ms.

### 3.4. Blokk 3 — Hosszú takarás

A gömb a pálya **40%-ánál eltűnik**: a vak szakasz 60%, azaz 840–1200 ms.
Ez az a tartomány, ahol a belső mozgásmodell tartása érdemben megterhelődik.

### 3.5. Blokk 4 — Sebesség

Takarás a 45%-nál, de a menetidő próbánként **három szint** valamelyike:
gyors (1100 ms), közepes (1600 ms), lassú (2200 ms), 8-8-8 próba, keverve.

Ez azt méri, hogy a résztvevő a **sebességhez skálázza-e** a becslést,
vagy egy megtanult „körülbelül ennyi idő” sablont használ. Utóbbi esetben a
konstans hiba szisztematikusan eltér a három sebességnél: a gyorsnál késik,
a lassúnál siet. Ezt a `velocity_scaling_error` mutatja meg.

### 3.6. Blokk 5 — Változó sebesség

Takarás a 45%-nál, de a takarás pillanatában a gömb sebessége
**megváltozik**: gyorsul (×1,35) vagy lassul (×0,70), 8-8 próba.
A résztvevő ezt nem látja, mert a változás pontosan az eltűnéskor történik.

**Kontroll:** a takarás előtti szakasz sebessége azonos a 4. blokk közepes
szintjével, tehát a takarás előtti információ nem árulja el a változást.

Az itt mért hiba iránya diagnosztikus: aki egyenletes sebességet feltételez,
a gyorsuló próbáknál **késik**, a lassulóknál **siet** — pontosan annyival,
amennyi a sebességváltozásból következik.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szögméret 3 m-ről | Szín |
|---|---|---|---|---|
| Mozgó gömb | sphere | 0,16 m | 3,1° | arculati kiemelő, emissziós |
| Sín | box (lapos) | 0,03 × 0,01 m | — | `#2B3646`, halvány |
| Célsík | plane, függőleges | 0,10 × 0,55 m | 1,9° × 10,4° | `#E8EEF5`, 0,8 opacitás |
| Célgyűrű | ring, a célsík körül | 0,22 m | 4,2° | arculati kiemelő |
| Takarási sáv | plane | változó | — | a háttérrel azonos szín, éles éllel |
| Indítójel | — | — | — | 900 Hz, 40 ms, a gömb indulásakor |

**A pálya geometriája.** A sín vízszintes, a résztvevő előtt 3,0 m-re,
szemmagasságban. Hossza VR-ben 4,4 m (±40° szögkiterjedés), lapos képernyőn
2,6 m (±23°). A cél mindig középen van; a gömb az egyik végéről indul.

**A takarás megvalósítása.** A gömb egyszerűen láthatatlanná válik
(`visible = false`) a takarási pontnál — nincs kitakaró tábla. Ennek oka:
egy fizikai takarófelület széle vizuális referenciát adna, amihez a becslés
igazítható lenne, és a feladat könnyebbé válna. Így a gömb eltűnése az egyetlen
esemény.

**Amit a résztvevő végig lát:** a sín teljes hosszában és a célsík. Ez
szándékos — a **térbeli** cél ismert, csak az **időbeli** becslés a feladat.

**Hang.** Indulásnál 900 Hz (40 ms). A becsapódásnál **nincs hang** mérés
közben — az visszajelzés lenne. Gyakorláskor a válasz után rövid hang jelzi
az előjelet: magas (1200 Hz) = korán, mély (400 Hz) = későn.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1–5 mind | `adapted` | A pálya szögkiterjedése a viewporthoz igazodik; a menetidők azonosak. |

**A menetidők platformfüggetlenek** — ez a lényeg. A hiba ezredmásodpercben
mérődik, tehát a pálya fizikai hossza nem befolyásolja az eredményt, csak a
szögsebességet. A szögsebesség viszont hat a becslésre, ezért a
`comparability` kulcs eszközosztályonként elkülöníti a futásokat.

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Pálya szögkiterjedés | ±40° | ±23° | ±18° |
| Pálya hossz | 4,4 m | 2,6 m | 2,0 m |
| Gömb szögméret | 3,1° | 3,1° | 4,0° |
| Menetidők | azonos | azonos | azonos |
| Takarási arányok | azonos | azonos | azonos |

### Platformonként kieső metrikák

Egy sem. Minden időzítési mutató mindhárom platformon értelmes.

### Irányítási szöveg platformonként

| VR | Asztali | Mobil |
|---|---|---|
| „Húzd meg a ravaszt PONTOSAN akkor, amikor a gömb elérné a fehér célt.” | „Kattints vagy nyomj SZÓKÖZT pontosan akkor, amikor a gömb elérné a fehér célt.” | „Koppints pontosan akkor, amikor a gömb elérné a fehér célt.” |

Mindhárom szövegben szerepel a **„nem kell gyorsnak lenned, pontosnak kell
lenned”** mondat, mert az alapértelmezett feltevés a reakcióidős értelmezés,
és ez rendszeres késést okozna az első próbákban.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: a takarás aránya, a menetidő (rövidebb = nehezebb),
a sebességszintek keverése, a takarás alatti sebességváltozás.

### `ANTICIPATE_STANDARD_A` (alapértelmezés)

```
visibleTrials 16      travelMs [1400,2000]  occlusion 0
shortOccTrials 20     travelMs [1400,2000]  occlusion 0.30
longOccTrials 20      travelMs [1400,2000]  occlusion 0.60
speedTrials 24        travelMs {1100,1600,2200} x8  occlusion 0.55
changeTrials 16       travelMs 1600  occlusion 0.55  factor {1.35, 0.70} x8
earlyRejectAt 0.25    lateTimeoutMs 1200   maxRepeats 3
```

### `ANTICIPATE_SHORT` (~4 perc)

```
visibleTrials 10   shortOccTrials 12   longOccTrials 12
speedTrials 12     changeTrials 8
```

### CHALLENGE mód

A takarás 75%-ig nő, a menetidő 800 ms-ig csökken, és a pontszám élőben
látszik ±50 ms-os tűréssel. Az assessment eredménnyel nem keverhető.

---

## 7. METRIKÁK

### Nyers (próbánként)
`travelMs` · `occlusionFraction` · `occlusionMs` · `direction` ·
`speedLevel` · `speedFactor` · `arrivalT` · `responseT` ·
`signedErrorMs` (válasz − érkezés; negatív = korai) · `absErrorMs` · `outcome`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `constant_error` | Az előjeles hibák átlaga, minden érvényes próbán (ms). Negatív = rendszeresen korán. |
| `variable_error` | Az előjeles hibák szórása (ms). **A fő pontossági mutató.** |
| `absolute_error` | Az abszolút hibák átlaga (ms) |
| `timing_error_ms` | = `absolute_error`, a manifeszt kompatibilitása miatt |
| `timing_variability` | = `variable_error` |
| `ce_visible` / `ce_short` / `ce_long` | Konstans hiba blokkonként |
| `ve_visible` / `ve_short` / `ve_long` | Variábilis hiba blokkonként |
| `occlusion_robustness` | A VE regressziós meredeksége a takarási idő ellen (ms VE / 100 ms takarás). Kicsi = a belső modell jól tart. |
| `occlusion_bias_shift` | `ce_long − ce_visible`: merre torzul a becslés, ha nem látja |
| `velocity_scaling_error` | A konstans hiba szórása a három sebességszint között (ms). Kicsi = jól skáláz. |
| `ce_fast` / `ce_medium` / `ce_slow` | Konstans hiba sebességszintenként |
| `constant_velocity_assumption` | A gyorsuló és lassuló próbák konstans hibájának különbsége (ms). Nagy pozitív érték = vakon egyenletes sebességet feltételez. |
| `early_response_rate` | A menetidő 25%-a előtti válaszok aránya |
| `timeout_rate` | Válasz nélkül lejárt próbák aránya |
| `reactive_strategy_index` | A látható blokk konstans hibája osztva 250 ms-mal, 0–1-re vágva. 1 közelében: reagál, nem előrejelez. |
| `consistency_trend` | A VE változása a blokkokon belül elsőtől az utolsó harmadig (tanulás vagy fáradás) |

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `timing_precision` | VE 45 ms | VE 200 ms | A koincidencia-időzítési irodalomban a jó teljesítmény jellemzően 40–70 ms VE. **Provizórikus** |
| `timing_accuracy` | \|CE\| 10 ms | \|CE\| 150 ms | A torzítás korrigálható, ezért kisebb súlyt kap |
| `occlusion_robustness_score` | meredekség 0 | 90 ms VE / 1000 ms takarás | **Provizórikus** |
| `velocity_scaling` | szórás 15 ms | 120 ms | |
| `adaptive_prediction` | \|CVA\| 0 ms | 250 ms | A takarás alatti sebességváltozás kezelése |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Időzítési pontosság (VE) | 0,34 |
| Takarás-robusztusság | 0,22 |
| Sebesség szerinti skálázás | 0,18 |
| Időzítési torzítás (CE) | 0,14 |
| Adaptív előrejelzés | 0,12 |

**A VE kapja a legnagyobb súlyt**, mert az a legkevésbé javítható és a
legjobban diszkriminál. A CE súlya szándékosan kicsi: a rendszeres sietés
vagy késés néhány edzésnyi visszajelzéssel korrigálható, tehát
kiválasztási szempontból kevésbé informatív.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `trial_setup` | travelMs, occlusionFraction, direction, speedLevel, speedFactor |
| `ball_launched` | t, travelMs, startX, targetX, quantisationMs |
| `ball_occluded` | t, fractionTravelled, remainingMs |
| `speed_changed` | t, factor, newTravelRemainMs |
| `arrival` | t (az elméleti becsapódás ideje) |
| `timing_response` | responseT, arrivalT, signedErrorMs, absErrorMs, phase (`before_occlusion` / `during_occlusion` / `after_arrival`) |
| `early_reject` | fractionTravelled |
| `timeout` | overshootMs |

**Mozgásnaplózás: 20 Hz.** A fejirány itt közelítő figyelmi mutató:
utólag elemezhető, hogy a résztvevő követte-e a gömböt, vagy előrenézett a
célra. Ez nem tekintetadat, és a metrika neve ezt kimondja
(`head_lead_index`, nem `gaze_lead`).

---

## 9. ADATBÁZIS

Új tábla nem kell.

```jsonc
// trials.stimulus
{ "kind": "anticipate", "block": "long", "travelMs": 1720, "occlusionFraction": 0.60,
  "occlusionMs": 1032, "direction": "left_to_right", "speedLevel": "medium",
  "speedFactor": 1.0, "trackExtentDeg": 40, "platform": "vr", "practice": false }

// trials.response
{ "signedErrorMs": -64.2, "absErrorMs": 64.2, "responsePhase": "during_occlusion",
  "fractionAtResponse": 0.93 }
```

Az előjeles hiba az egyetlen mező, amit az elemzés valóban használ, de az
`fractionAtResponse` (a pálya mekkora részénél válaszolt) elárulja a
stratégiát, és utólag nem rekonstruálható.

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „ANTICIPATE / Időzítés & előrejelzés”. Kiemelten:
   *„Ez nem reakcióteszt. Nem az számít, milyen gyorsan reagálsz, hanem hogy
   pontosan eltalálod-e a pillanatot. Nyugodtan válaszolhatsz korábban is —
   sőt, néha kell.”*
2. **INSTRUKCIÓ** blokkonként, a takarás bemutatásával.
3. **GYAKORLÁS** előjeles visszajelzéssel: „−82 ms · KORÁN” vagy
   „+45 ms · KÉSŐN”. Az előjel megmutatása itt fontos: enélkül a résztvevő
   nem tudja, melyik irányba korrigáljon, és az első mért blokk fél része
   ráhangolódással telne.
4. **„MOST JÖN A MÉRÉS”**.
5. **MÉRÉS**.
6. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Időzítési pontosság (VE) | `62 ms` |
| Időzítési torzítás (CE) | `−28 ms` (korán) |
| Takarás-robusztusság | `+34 ms` hosszú takarásnál |
| Sebesség-skálázás | `21 ms` szórás |
| Sebességváltás kezelése | `112 ms` |
| Érvénytelen próba | `2 / 96` |

Sport területen kiegészítve: *„A torzítás (CE) néhány edzés alatt
korrigálható. A szórás (VE) a nehezebben javuló, stabilabb jellemző.”*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az elrendezés a koincidencia-időzítési paradigma, amely
klasszikusan egy fénysoros készülékkel készül: fények futnak egy sínen, és a
résztvevőnek a célfény felgyulladásának pillanatában kell reagálnia. A CE/VE/AE
hármas ebből a hagyományból származik. A takarásos változat az időbeli
okklúziós paradigmából jön, amelyet sportszakértői kutatásokban használnak.

**Eltérések.** (a) A klasszikus készülék diszkrét fényeket használ,
itt folyamatos mozgás van, ami simább sebességinformációt ad. (b) A takarás
itt a tárgy eltűnése, nem fizikai takarófelület — ezt a 4. fejezet indokolja.
(c) A sportszakértői okklúziós vizsgálatok valós ellenfelek videóját takarják;
itt absztrakt mozgás van, tehát a **domén-specifikus** mintázatfelismerés
nem játszik szerepet. Ez szándékos: a modul a mögöttes időzítési gépezetet
méri, nem a sportági tapasztalatot. A domén-specifikus változat a 19 INTENT
modul feladata.

**Elvárt nagyságrendek** (egészséges felnőtt, sportági tapasztalat nélkül):
VE látható pályán 40–90 ms · VE hosszú takarásnál 70–160 ms ·
CE −60 és +40 ms között (a korai torzítás gyakoribb) ·
sebesség-skálázási szórás 15–70 ms.
Ütősportot űzőknél a VE jellemzően alacsonyabb, és a takarás kevésbé rontja.

**A reagáló stratégia felismerése.** Aki nem előrejelez, hanem reagál,
annál a látható blokkban is nagy pozitív CE lesz (200 ms felett). A
`reactive_strategy_index` ezt jelzi, és **ilyenkor az összes többi mutató
óvatosan értelmezendő**, mert a résztvevő nem a kért feladatot végezte.
Az eredményképernyő ilyenkor külön figyelmeztet.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
sportági alkalmasság, sem vezetői alkalmatlanság. Fiatalkorúaknál a
teljesítmény életkorral erősen változik, tehát az összehasonlítás csak
életkori sávon belül értelmes — a jelenlegi verzióban **nincs életkori
normánk**, és ezt ki kell mondani.

**Tanulási hatás.** A CE gyorsan javul (2–3 felvétel), mert a torzítás
könnyen korrigálható. A VE **lassan** javul, ezért az longitudinálisan is
használható. Ismételt mérésnél a menetidők és az irányok seedből változnak.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. Az előjeles hiba a válasz és az **elméleti** érkezési idő különbsége,
   ahol az érkezési idő az indulási frame időbélyegéből és a menetidőből
   számolódik, nem a gömb megjelenített pozíciójából.
2. Negatív előjelű hiba (korai válasz) érvényes eredmény, nem hiba.
3. A menetidő 25%-a előtti válasz `invalid`, és a próba a blokk végén
   megismétlődik, legfeljebb háromszor.
4. Az érkezés után 1200 ms-mal válasz nélkül a próba `timeout`.
5. A takarási pontnál a gömb egyetlen frame alatt tűnik el, kitakaró
   felület nélkül.
6. A 4. blokkban a három sebességszint pontosan 8-8-8 próbát kap.
7. Az 5. blokkban a sebességváltozás pontosan a takarás frame-jében történik,
   és a takarás előtti szakasz mindhárom próbatípusnál azonos sebességű.
8. Két azonos seedű futás azonos menetidő-, irány- és sebességsorozatot ad.
9. Mérés közben nincs semmilyen visszajelzés a hibáról vagy annak előjeléről.
10. A gyakorló próbák nem kerülnek a pontozásba.
11. A variábilis hiba az előjeles hibák szórása, nem az abszolút hibáké
    (ezt a különbséget egy szintetikus adatsorral kell ellenőrizni:
    állandó +100 ms hibánál a VE ≈ 0, az AE = 100).
12. Minden `ball_launched` esemény tartalmaz `quantisationMs` mezőt.
13. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
14. Ha a `reactive_strategy_index` 0,7 fölött van, az eredményképernyő
    külön figyelmeztetést jelenít meg.
15. Szintetikus profilokon (precíz / átlagos / szórt) az OPS pontszám
    monoton csökkenő, legalább 180 pont különbséggel a szélsők között.
16. Egy szintetikus profil, amelynek nagy a CE-je de kicsi a VE-je,
    magasabb OPS pontszámot kap, mint egy azonos AE-jű, de nagy VE-jű profil.

---

# B VÁLTOZAT — ÜTKÖZÉSIG HÁTRALÉVŐ IDŐ (`ANTICIPATE_SPATIAL_B`)

Ez a fejezet a modul **B változatát** írja le. Az A változat (1–12. fejezet)
változatlan. A B változat VR-ben és asztali böngészőben is fut, de az
asztali változatból a mélységi támpontok egy része hiányzik, amit az
eredményképernyő kiír.

## B/1. Miért van B változat

Az A változat coincidence-anticipation feladat: egy jelölő halad egy pálya
mentén, és a résztvevőnek a célvonalnál kell reagálnia. Ez a Bassin-féle
anticipation timer VR-es változata, és önmagában érvényes — de a laposítási
teszten megbukik: a jelölő egy síkon mozog, oldalirányban. A mért mennyiség
egy **oldalirányú** pálya extrapolációja.

A valóságban — sportban és védelmi helyzetben egyaránt — az anticipáció
tárgya majdnem mindig **feléd közeledő** dolog: labda, ellenfél, jármű.
Ez perceptuálisan más feladat, mert a támpont nem az elmozdulás, hanem a
**látószög tágulása**. A B változat ezt méri, és vele együtt azt a
kérdést, hogy a résztvevő **melyik stratégiát használja**.

## B/2. A mérés, amit a lapos verzió szerkezetileg nem tud

Az ütközésig hátralévő idő becslésére két út van:

1. **Tau (τ)** — a látószög és a tágulási sebességének hányadosa. Optikailag
   pontos, és **független a tárgy fizikai méretétől**.
2. **Méret-heurisztika** — „ami nagyobbnak látszik, az közelebb van, tehát
   hamarabb ér ide”. Gyors, de szisztematikusan téved: a nagy tárgyat
   korábbinak, a kicsit későbbinek ítéli.

A kettő megkülönböztetéséhez **azonos érkezési idejű, eltérő fizikai méretű**
tárgyak kellenek. A `size` blokk pontosan ezt csinálja: 0,10 / 0,18 / 0,30 m
sugarú gömbök, **azonos érkezési ütemtervvel**. Ha a résztvevő tau alapján
dolgozik, a három méret hibája megegyezik. Ha méret-heurisztikát használ,
a nagy gömböknél korán reagál.

```
size_arrival_effect = ce_size_small − ce_size_large
tau_reliance        = clamp(1 − |size_arrival_effect| / 250, 0, 1)
```

Ez egy **stratégia-diagnózis**, nem csak egy pontszám: a kiválasztásban
két azonos pontosságú jelölt közül az, aki tau alapján dolgozik, robusztusabb
lesz ismeretlen tárgyméretek mellett. Az eredményképernyő ezért kiírja:
„tau-alapú becslés” vagy „méret-heurisztika”.

**Miért nem lehet ezt lapos kijelzőn megmérni:** a méret-heurisztika és a tau
csak akkor válik szét, ha a tárgy valóban közeledik. Oldalirányú mozgásnál
a fizikai méret nem befolyásolja az érkezési időt, tehát nincs mit
összekeverni — a kérdés fel sem tehető.

## B/3. Feladatstruktúra

| # | Blokk | Próba | Gyakorlás | Cél |
|---|---|---|---|---|
| 1 | `approach` — KÖZELEDÉS | 18 | 5 | alap TTC-becslés, takarás nélkül |
| 2 | `occluded` — TAKART KÖZELEDÉS | 24 | 4 | belső extrapoláció két takarási hossznál |
| 3 | `size` — MÉRET | 27 | 4 | tau vs. méret-heurisztika |
| 4 | `angle` — IRÁNY | 20 | 4 | nem szemből érkező pálya |

**1. blokk.** A gömb 11–16 m-ről indul, és 1500–2300 ms alatt teszi meg az utat
a résztvevőig. Nincs takarás. A feladat: a **fejhez érkezés pillanatában**
megnyomni a gombot.

**2. blokk.** A gömb az út utolsó szakaszán eltűnik. Két takarási arány:
a repülési idő **35%-a és 62%-a**, próbánként fele-fele. Az
`occlusion_robustness` a szórás növekedése a vak szakasz másodpercére vetítve
(ms / 1000 ms vak). Ez a belső idői modell minősége.

**3. blokk.** Három fizikai méret (0,10 / 0,18 / 0,30 m), **1900 ms fix
repülési idő és 45% takarás mindegyiknél**. A takarás itt lényeges: enélkül a
résztvevő az utolsó pillanatban láthatná a gömböt, és a méret hatása
eltűnne a záró vizuális korrekcióban.

**4. blokk.** A gömb nem szemből, hanem oldalról vagy felülről érkezik.
A próbák fele szemből jön (±6°-on belül), fele valóban oldalt, így a
kontraszt egy blokkon belül áll elő. A takarás itt is 45%, hogy a
3. blokkal összevethető maradjon. Az `approach_angle_cost` a szórás
növekedése a 10°-nál nagyobb excentricitású pályákon a szemből érkezőkhöz képest.

## B/4. Ingerdefiníció

Egyetlen primitív: **gömb**, `accent` színben, unlit anyaggal, hogy a fényviszonyok
ne adjanak további távolsági támpontot. Alapátmérő 0,18 m; a `size` blokkban
a skálázás a fizikai méretet változtatja (`scale = r / 0,18`), tehát a
látószög is változik — **ez a lényeg**, itt nem kompenzálunk. A többi blokkban
minden gömb 0,18 m.

A pálya egyenes vonalú, egyenletes sebességű. Nincs gravitáció: a
gyorsulás becslése külön képesség, és nem szeretnénk összekeverni a
tau-használattal.

## B/5. Keresztplatform leképezés

| Elem | VR | Desktop / mobil | Besorolás |
|---|---|---|---|
| Válasz | ravasz | Szóköz / koppintás | `equivalent` |
| Közeledés | valós diszparitás + tágulás | csak tágulás | `adapted` |
| Méret-manipuláció | fizikai méret 3 szinten | ugyanaz | `equivalent` |
| Érkezési pont | a fej valós pozíciója | a kamera pozíciója | `adapted` |

A `size_arrival_effect` **lapos platformon is mérhető** (a tágulás ott is
látszik), de gyengébben, mert a diszparitás nem korrigálja a heurisztikát.
Ezért a B változat lapos platformon fut, de az eredmény
`comparability` kulcsa `flat:mouse` / `flat:touch`, és soha nem kerül közös
normacsoportba a VR-futásokkal.

## B/6. Metrikák

| Metrika | Definíció | Egység |
|---|---|---|
| `constant_error` | előjeles átlagos időzítési hiba (− = korán) | ms |
| `variable_error` | az időzítési hibák szórása — **a fő pontossági mutató** | ms |
| `occlusion_robustness` | a szórás növekedése a vak szakasz másodpercére | ms/1000 ms |
| `ce_size_small` / `_medium` / `_large` | előjeles hiba méretszintenként | ms |
| `size_arrival_effect` | `ce_size_small − ce_size_large` | ms |
| `size_arrival_slope` | a hiba regressziós meredeksége a fizikai sugárra | ms/m |
| `tau_reliance` | 0–1 index, 1 = a méret nem számít | index |
| `approach_angle_cost` | `ve_off_axis − ve_head_on` | ms |
| `reactive_strategy_index` | 0–1; magas érték = reagált, nem előre jelzett | index |

A `reactive_strategy_index` biztonsági metrika: ha a résztvevő
következetesen későn válaszol az `approach` blokkban, akkor valószínűleg
**megvárta**, hogy a gömb odaérjen, ahelyett hogy előre jelezte volna.
Ilyenkor az eredményképernyő figyelmeztet, mert a többi metrika
értelmezése megváltozik.

**OPS SCORE:**

| Összetevő | Súly |
|---|---|
| `timing_precision` (VE) | 0,32 |
| `tau_use` | 0,24 |
| `occlusion_robustness_score` | 0,20 |
| `timing_accuracy` (\|CE\|) | 0,12 |
| `approach_angle` | 0,12 |

A `tau_use` súlya szándékosan magas: két azonos pontosságú futás közül az,
amelyik nem méret-heurisztikára támaszkodik, magasabb pontszámot kap.

## B/7. Validáció és korlátok

**Származás.** Lee tau-hipotézise (1976) az ütközésig hátralévő idő optikai
meghatározásáról; a méret-érkezés hatás a TTC-irodalom jól dokumentált
torzítása (nagyobb tárgyat korábban érkezőnek ítélnek). A takarásos blokk a
prediction-motion / temporal occlusion paradigma. Az alapfeladat a Bassin-féle
anticipation timing háromdimenziós megfelelője.

**Eltérés.** A klasszikus TTC-kísérletek gyakran képernyőn, monokulárisan
zajlanak, és a válasz „mikor ért volna ide” utólagos becslés. Itt a válasz
valós idejű, és a binokuláris diszparitás is rendelkezésre áll — ezért az
abszolút értékek nem hasonlíthatók közvetlenül a képernyős irodalmi
adatokhoz, csak a **hatások iránya** és nagyságrendje.

**Elvárt nagyságrend** egészséges felnőttnél VR-ben: `variable_error`
60–130 ms, `constant_error` −60…0 ms (enyhe korai torzítás normális),
`occlusion_robustness` 20–70 ms/s, `size_arrival_effect` 10–90 ms.
250 ms fölötti méret-hatás erős heurisztikahasználatot jelez.

**Amit nem szabad kikövetkeztetni:** sportági alkalmasságot. Az anticipáció
sportspecifikus tudással erősen modulált; egy labdajátékos a saját
labdaméreténél pontosabb, mint ismeretlen tárgynál. A modul általános
TTC-becslést mér, ismeretlen tárgyakkal, ami épp ezért **kiválasztási
helyzetben informatívabb**, mint a sportspecifikus teljesítmény — de nem
helyettesíti azt.

**Tanulási hatás.** A tau-használat rövid távon nem tanítható, de a
konstans hiba (CE) 2–3 felvétel alatt nullához közelít, mert a résztvevő
kalibrálja magát. A **VE és a `size_arrival_effect` stabilabb**, ezért
ismételt méréseknél ezeket kell elsődlegesen nézni.

## B/8. Elfogadási kritériumok

1. A `size` blokk három méretszintje azonos repülési idejű ütemtervet kap.
2. A `size` blokkban minden próbában van takarás (45%), tehát a záró
   vizuális korrekció nem lehetséges.
3. Az `occluded` blokk két takarási aránya (35% és 62%) fele-fele arányban szerepel.
4. A `size_arrival_effect` előjele pozitív, ha a résztvevő a nagy gömbnél korábban válaszol.
5. Tau-alapú és heurisztikus válaszmintázat azonos szórás mellett is elkülönül
   (tesztelve: `tests/variants.test.ts`).
6. Az azonos pontosságú, de tau-alapú futás magasabb OPS-t kap.
7. Az eredményképernyő megnevezi a stratégiát („tau-alapú becslés” / „méret-heurisztika”).
8. A repülés első 25%-án belül adott válasz `invalid` kimenettel zárul,
   `early_reject` eseményt naplóz, és nem kerül a hibaszámításba. A találat
   határa külön ettől: |hiba| ≤ 100 ms.
9. Azonos seed azonos pálya- és méretsorrendet ad.
10. Egy teljes B futás 8–11 perc.
11. A `reactive_strategy_index` > 0,7 esetén az eredményképernyő figyelmeztet.
