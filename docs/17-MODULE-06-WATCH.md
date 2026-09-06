# 17 — MODUL 06: WATCH
## Éberség & perifériás figyelem — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/watch/WatchModule.ts`
**Támogatott platformok:** VR (teljes) · asztali, mobil (szűkített — lásd 5. fejezet)
**Névleges időtartam:** ~11 perc
**Doménkötés:** A elsődleges · B elsődleges · C másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a WATCH azt méri, mennyire marad meg valakinek a
ritka események észlelése egy hosszú, monoton figyelési feladat alatt —
és **hol** marad meg: szűkül-e a ténylegesen felügyelt tér, ahogy telik az idő.

### Miért nem sík felület

A klasszikus éberségi feladat egy képernyőre néző résztvevővel dolgozik.
Ez egy dolgot mér: hogy az események *idővel* elkerülik-e a figyelmét.
Egy őrszolgálat, egy vezérlőterem vagy egy szenzoroperátori beosztás
viszont **térben** történik: az esemény lehet mögötted, fölötted, messze.

Ez a modul ezért a résztvevőt **teljes 360°-os emitterrács közepébe**
állítja. Ebből három olyan mérés következik, amit sík kijelzőn nem lehet
elvégezni:

1. **Térbeli lefedettség.** A pásztázás nem közelítő mutató, hanem a feladat
   maga: aki nem fordul meg, az nem lát. A fejirány-eloszlás entrópiája és
   a lefedett szektor mérete valódi viselkedési változó.
2. **Térbeli éberség-lejtés** (`scan_shrinkage`). A klasszikus éberség-lejtés
   időbeli: romlik a detekció. Itt ehhez hozzájön a **térbeli** lejtés: az
   utolsó harmadban ténylegesen felügyelt szektor a kezdetinek hány százaléka.
   Két résztvevő azonos detekciós romlással teljesen máshogy viselkedhet:
   az egyik lassabban vesz észre mindent, a másik egyszerűen abbahagyja a
   hátrafordulást. Ez a második mintázat operatív szempontból veszélyesebb,
   és **csak térben mérhető**.
3. **Hátsó szektor detekciója** (`rear_hit_rate`). Az emitterek 30%-a a
   résztvevő mögött van a kezdő tájolásnál. Az ott bekövetkező események
   észlelése csak akkor lehetséges, ha valaki ténylegesen körbenéz.

### A mélység mint önálló csatorna

Az emitterek 3,2 és 8,5 m között helyezkednek el, de a **szögméretük
azonos** — a méret a távolsággal arányosan nő. A távolság így kizárólag
binokuláris diszparitáson és mozgásparallaxison keresztül érzékelhető,
ami headsetben létezik, sík képernyőn nem. A `depth_cost` metrika
(közeli és távoli események detekciós különbsége) ezért **VR-only**,
és a neve ezt ki is mondja.

### Mért konstruktumok

| Konstruktum | Katalógus # | Paradigma |
|---|---|---|
| Tartós figyelem | 21 | Vigilance / rare-event monitoring |
| Éberség-lejtés | 132 | Vigilance decrement |
| Perifériás észlelés | 17 | Excentricitás szerinti detekció |
| Jelészlelés | — | *d′* és kritérium |
| Hangirány-felismerés | 93 | Térbeli hangesemény |
| Fáradtság alatti teljesítmény | 70 | Blokkok közti romlás |
| Pásztázási lefedettség | 135 | Fejirány-eloszlás (VR) |

### Amit a modul NEM mér

- **Nem méri a több órás szolgálatot.** Tizenegy perc rövid egy éberségi
  feladathoz. A lejtés kimutatható, de a nyolcórás műszakra való
  extrapoláció nem indokolt.
- **Nem szemmozgás.** A pásztázási mutatók fejirányból számolnak. A szem
  a fejhez képest ±30°-ot mozdul anélkül, hogy a fej fordulna, ezért a
  metrikák neve `head_scan_*`, nem `gaze_*`.
- **Nem alvásmegvonás-teszt.** A lejtés érzékeny a fáradtságra, de egyetlen
  felvételből alvásállapotra következtetni nem szabad.
- **Nem hallásvizsgálat.** A térbeli hangesemények jóval küszöb felettiek.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** Őr-, megfigyelő- és szenzoroperátori
szolgálat: órákig tartó monoton figyelés ritka, de kritikus eseményekre.
A `scan_shrinkage` közvetlenül az a viselkedés, amit az őrszolgálati
kiképzés meg akar előzni: a felügyelt szektor észrevétlen összeszűkülése.
Beosztások: őr, szenzoroperátor, ügyeletes, radarkezelő.

**B — Munkaalkalmasság (elsődleges).** Éjszakai műszak, vezérlőterem,
hosszú vezetés. Az éberség-lejtés azt méri, meddig tartható a figyelem,
nem azt, mekkora induláskor — és műszak eleji/végi ismételt felvétellel
közvetlen fáradtságmutatóvá válik.
Munkakörök: vezérlőterem-operátor, kamionsofőr, biztonsági őr, éjszakás ápoló.

**C — Sport (másodlagos).** Hosszú versenyek fókusz-stabilitása:
sportlövészet, íjászat, ultrafutás, vitorlázás.

---

## 3. FELADATSTRUKTÚRA

A résztvevő egy **32 emitterből álló rács** közepén áll. Minden emitter
egy világító gömb egy vékony oszlop tetején. Alaphelyzetben az egész rács
**szinkronban pulzál**, 1,15 Hz-en.

A feladat: reagálni, valahányszor **egyetlen emitter kilép a mintázatból**.

| # | Blokk | Gyakorló | Idő | Eseményráta | Mit izolál |
|---|---|---|---|---|---|
| 1 | KALIBRÁCIÓ | 6 esemény | 100 s | 1 / 7 s | detekciós képesség fáradás nélkül |
| 2 | SZOLGÁLAT A | — | 240 s | 1 / 14 s | időbeli és térbeli lejtés, statikus rács |
| 3 | SZOLGÁLAT B | — | 240 s | 1 / 14 s | lejtés forgó rács és hangesemények mellett |

Összesen ~9,7 perc mérés + gyakorlás.

### 3.1. Eseménytípusok

| Típus | Leírás | Arány |
|---|---|---|
| `skip` | egy emitter kihagy egy pulzust | 26% |
| `double` | egy emitter kétszer pulzál egy ütem alatt | 26% |
| `hue` | egy emitter színe elvált egy pulzus erejéig | 22% |
| `drift` | egy emitter kimozdul a helyéről 1,2 s alatt, majd visszatér | 14% |
| `audio` | térbeli hangimpulzus egy emitter irányából, vizuális változás nélkül | 12% |

A `drift` és az `audio` szándékosan ritka: mindkettő térbeli jelzés, és a
gyakoriságuk növelése a résztvevőt arra tanítaná, hogy a mozgásra és a
hangra hagyatkozzon a szinkron megbontása helyett.

**Az `audio` esemény csak VR-ben és fejhallgatóval értelmes**, mert az
irány a HRTF-panorámázásból származik. Sík platformon a modul kiveszi az
eseménykészletből, és ezt rögzíti.

### 3.2. Válaszablak és fogások

- **Válaszablak:** 2400 ms az esemény kezdetétől. Ennél hosszabb ablak
  mellett a válasz már nem köthető az eseményhez.
- **Fogások (üres időszakok):** az eseményközök exponenciális eloszlásból
  jönnek, minimum 4 s távolsággal. Bármely, eseményablakon kívüli válasz
  **téves riasztás**.
- A téves riasztás mérése enélkül lehetetlen lenne: külön „üres próbák”
  nincsenek, mert a feladat folyamatos, nem próbákra bontott.

### 3.3. Blokk 1 — Kalibráció

Magas eseményráta (1 / 7 s), 100 s, statikus rács. Célja, hogy a
detekciós képességet **fáradás előtt** mérje. A 2. és 3. blokk *d′*-jét
ehhez viszonyítjuk, így az éberség-lejtés a személy saját kiindulásához
képest értelmezhető.

### 3.4. Blokk 2 — Szolgálat A

240 s, alacsony eseményráta, statikus rács. A blokk **három harmadra**
bontva elemzendő: a *d′*, a hit rate, a reakcióidő és a pásztázási
lefedettség harmadonként külön kiszámolódik.

### 3.5. Blokk 3 — Szolgálat B

240 s, azonos ráta, de:
- a **rács lassan forog** a résztvevő függőleges tengelye körül (2,2°/s),
  tehát az emitterek a látómezőn átvándorolnak, és a pozíciók nem
  memorizálhatók;
- a **hangesemények** aktívak;
- a rács forgása miatt minden emitter előbb-utóbb a hátsó szektorba kerül.

240 s alatt a rács 528°-ot fordul, azaz több mint egy teljes kört.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szögméret | Szín |
|---|---|---|---|---|
| Emitter gömb | sphere | 0,17 m × depthScale | 3,0° (állandó) | `#3C7FB1` alap, kiemelő pulzuson |
| Emitter oszlop | cylinder | 0,03 m × 1,1 m | — | `#1B2836` |
| Alaplemez | cylinder, lapos | 0,26 m | — | `#16202C` |
| `hue` esemény színe | — | — | — | `#FF9E1B` (védelmi) / arculati `accent2` |
| `drift` elmozdulás | — | 0,55 m oldalirányban | ~7° | — |

**Elrendezés.** 32 emitter, teljes 360° azimut sztratifikált mintavétellel
(minden 11,25°-os szektorba egy, ±32% jitterrel), elevatio −16° és +26°
között, távolság 3,2–8,5 m. Minimális szögtávolság 9°.

**Miért van oszlop és alaplemez?** Mert egy magában lebegő gömbnek nincs
mélységi horgonya. Az oszlop és a talajlemez perspektívája adja meg, milyen
messze van az emitter — ez az, ami a jelenetet térré teszi ahelyett, hogy
pontok halmaza lenne egy gömbfelületen.

**Pulzus.** Minden emitter emissziós intenzitása 1,15 Hz-en szinuszosan
0,25 és 1,0 között ingadozik, **közös fázissal**. A közös fázis kritikus:
enélkül nem lenne mintázat, amiből kilépni lehet.

**Hang.** A pulzussal **nincs** hang — egy 1,15 Hz-es kattogás tíz percen
át elviselhetetlen és hallási időzítési támpontot adna. A `audio` esemény
egy 660 Hz-es, 180 ms-os térbeli tónus az adott emitter pozíciójából.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Elem | Osztály | Indoklás |
|---|---|---|
| Detekciós feladat | `equivalent` | Az esemény felismerése mindenhol ugyanaz. |
| Teljes surround | **`vr-only`** | 65°-os viewportba nem fér bele 360°. |
| Mélységi manipuláció | **`vr-only`** | Sík képernyőn nincs diszparitás. |
| Térbeli hangesemény | **`vr-only`** | Fejkövetés nélkül az irány nem informatív. |
| Rács forgása | `adapted` | Sík módban az emitterek átvándorolnak a szűk viewporton. |

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Azimut | teljes 360° | ±26° | ±20° |
| Elevatio | −16° … +26° | −11° … +13° | −10° … +12° |
| Emitterszám | 32 | 18 | 14 |
| Távolság | 3,2 – 8,5 m | 4,0 – 5,2 m | 4,0 – 5,0 m |
| Eseménykészlet | mind az 5 | `audio` nélkül | `audio` nélkül |
| Rács forgása | 2,2°/s | 1,2°/s | 1,0°/s |

**A sík platformon a modul lényegesen kevesebbet mér, és ezt ki kell
mondani.** Az asztali és mobil futás érvényes éberségi mérés, de a
térbeli lefedettség, a hátsó detekció és a mélységi költség nem
értelmezhető. Az eredményképernyő ilyenkor öt sort mutat hat helyett, és
kiírja, hogy a térbeli mutatók VR-t igényelnek.

### Platformonként kieső metrikák

| Metrika | VR | Asztali / mobil |
|---|---|---|
| `head_scan_range`, `head_scan_entropy` | ✓ | **kiesik** |
| `scan_shrinkage` | ✓ | **kiesik** |
| `rear_hit_rate` | ✓ | **kiesik** |
| `depth_cost` | ✓ | **kiesik** |
| `audio_hit_rate` | ✓ | **kiesik** |
| *d′*, kritérium, lejtés, RT, excentricitás-költség | ✓ | ✓ |

### Irányítási szöveg platformonként

| VR | Asztali | Mobil |
|---|---|---|
| „Fordulj körbe nyugodtan — az események bárhol történhetnek, akár mögötted is. Húzd meg a ravaszt, amint bármelyik fény kilép a közös ütemből.” | „Nyomj SZÓKÖZT, amint bármelyik fény kilép a közös ütemből.” | „Koppints, amint bármelyik fény kilép a közös ütemből.” |

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: az eseményráta (ritkább = nehezebb), a blokk hossza,
az emitterszám, az esemény nagysága, a rács forgása, a mélységi terjedelem.

### `WATCH_STANDARD_A` (alapértelmezés)

```
emitters 32   pulseHz 1.15   azSpan 360   el [-16,26]   r [3.2,8.5]   minSep 9
calibration  100s  rate 7s
watchA       240s  rate 14s  rotation 0
watchB       240s  rate 14s  rotation 2.2deg/s  audio on
responseWindowMs 2400   minGapMs 4000
```

### `WATCH_SHORT` (~5 perc, szűrésre)

```
calibration 70s rate 6s   watchA 120s rate 11s   watchB 120s rate 11s
```

### `WATCH_LONG` (~22 perc, kutatási célra)

```
calibration 100s   watchA 600s   watchB 600s   rate 18s
```

A hosszú változat az, amelyikből az éberség-lejtés **megbízhatóan**
becsülhető; a standard 4 perces blokkjai a lejtés irányát mutatják, a
meredekség becslése zajos. Ezt a validációs fejezet is kimondja.

### CHALLENGE mód

Ritkább események, kisebb eseménynagyság, gyorsabb forgás, élő pontszám.
Az assessment eredménnyel nem keverhető.

---

## 7. METRIKÁK

### Nyers (eseményenként)
`eventType` · `emitterIndex` · `azDeg` · `elDeg` · `radius` ·
`eccentricityAtOnsetDeg` · `behindAtOnset` · `onsetT` · `responseT` ·
`rtMs` · `detected` · `blockThird`

Külön rekordként: `false_alarm` minden eseményablakon kívüli válaszra.

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `hit_rate` | Detektált / összes esemény (2. és 3. blokk) |
| `false_alarms` | Eseményablakon kívüli válaszok száma |
| `false_alarm_rate` | Téves riasztás / perc |
| `d_prime` | Jelészlelés-elméleti érzékenység; a „zajpróbák” száma a válaszablakok számából becsülve (lásd lent) |
| `criterion` | Válaszkritérium; pozitív = konzervatív |
| `median_rt` | Medián detekciós idő a találatokon |
| `vigilance_decrement_hitrate` | A hit rate regressziós meredeksége a blokkharmadok ellen (arány / harmad) |
| `vigilance_decrement_dprime` | Ugyanez *d′*-ben |
| `vigilance_decrement_rt` | A medián RT meredeksége harmadonként (ms / harmad) |
| `calibration_hit_rate` | Az 1. blokk hit rate-je — a fáradás előtti alapvonal |
| `fatigue_index` | `calibration_hit_rate − hit_rate`: mennyivel romlott a szolgálati blokkokban |
| `eccentricity_cost` | A hit rate meredeksége az esemény kezdeti excentricitása ellen |
| `rear_hit_rate` | Detekciós arány a 100°-nál nagyobb excentricitású eseményeken (**VR**) |
| `rear_event_share` | Ezen események aránya — a viselkedés kontextusa |
| `depth_cost` | Hit rate(közeli fele) − hit rate(távoli fele) (**VR**) |
| `audio_hit_rate` | Detekciós arány a hangeseményeken (**VR**) |
| `hit_rate_by_type` | Típusonkénti detekciós arány (5 érték) |
| `head_scan_range` | A fejirány azimut 5–95 percentilis tartománya (**VR**) |
| `head_scan_entropy` | A fejirány-eloszlás normalizált entrópiája 24 rekeszen (**VR**) |
| `scan_shrinkage` | Az utolsó harmad lefedett szektora / az első harmadé (**VR**). 1 alatt = szűkülő felügyelet. |
| `scan_rate` | Fejfordulás mértéke fok/perc — mennyit pásztáz egyáltalán |

**A *d′* becsléséről.** Folyamatos figyelési feladatban nincsenek diszkrét
„zajpróbák”, tehát a téves riasztás rátájához referencia kell. A szokásos
megoldást használjuk: az időt a válaszablak hosszával (2400 ms) osztjuk fel
fiktív próbákra, és a nem eseményhez tartozó ablakokat tekintjük
zajpróbáknak. Ez konvenció, nem mérés — a metrika mellé kerül egy
`d_prime_noise_trials` mező, hogy az elemzés tudja, mihez képest.

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `sustained_attention` | *d′* 3,5 | 0,7 | Jelészlelés-elméleti tartomány |
| `vigilance_stability` | lejtés 0 | −0,30 hit rate / harmad | **Provizórikus** |
| `spatial_coverage` | entrópia 0,85 | 0,30 | Egyenletes körbenézés = 1,0 (**VR**) |
| `coverage_persistence` | `scan_shrinkage` 1,0 | 0,45 | **Provizórikus** (**VR**) |
| `response_discipline` | 0 téves riasztás | 12 / 10 perc | |
| `detection_speed` | medián RT 600 ms | 1900 ms | |

### OPS SCORE

**VR:**

| Összetevő | Súly |
|---|---|
| Tartós figyelem (*d′*) | 0,28 |
| Éberség-stabilitás (lejtés) | 0,22 |
| Térbeli lefedettség | 0,16 |
| Lefedettség megtartása | 0,14 |
| Válaszfegyelem (téves riasztás) | 0,12 |
| Detekciós sebesség | 0,08 |

**Sík platformon** a két térbeli összetevő súlya nulla, és a maradék négy
súlya arányosan felskálázódik. Ezt az eredményképernyő kiírja, hogy egy
0,72-es VR-pontszám és egy 0,72-es asztali pontszám ne legyen
összetéveszthető.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `lattice_built` | emitters, azSpan, rRange, elRange, seed |
| `watch_event` | eventType, emitterIndex, azDeg, elDeg, radius, eccentricityDeg, behind, quantisationMs |
| `watch_response` | rtMs, detected, eventType, eccentricityDeg, behind |
| `watch_false_alarm` | sinceLastEventMs |
| `watch_miss` | eventType, eccentricityDeg, behind |
| `head_sample` | yawDeg, pitchDeg — 5 Hz |
| `third_summary` | third, hits, events, dPrime, medianRt, scanRangeDeg |
| `lattice_rotation` | degPerSec |

**Mozgásnaplózás: 10 Hz.** A fejpálya itt maga a mérés egy része
(lefedettség és annak időbeli alakulása), tehát a teljes futás rögzül.
Egy 11 perces futás ~6600 minta.

---

## 9. ADATBÁZIS

Új tábla nem kell. Minden esemény egy `trials` sor:

```jsonc
// trials.stimulus
{ "kind": "watch", "block": "watchB", "eventType": "drift", "emitterIndex": 17,
  "azDeg": -134.2, "elDeg": 8.1, "radius": 6.4, "eccentricityDeg": 148.6,
  "behind": true, "third": 2, "practice": false }

// trials.response
{ "rtMs": 1120.4, "detected": true }
```

A `false_alarm` sorok `stimulus.kind = "watch_false_alarm"` értékkel és
`response.sinceLastEventMs` mezővel kerülnek be.

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „WATCH / Éberség & perifériás figyelem”. Kiemelve:
   *„Ez a leghosszabb modul, és szándékosan monoton. Nem az a feladat, hogy
   végig maximálisan koncentrálj — hanem hogy ne veszíts el eseményeket.
   Nyugodtan fordulj körbe.”*
2. **INSTRUKCIÓ** — a rács bemutatása, az öt eseménytípus egyenkénti
   megmutatása lassítva.
3. **GYAKORLÁS** — 6 esemény visszajelzéssel; mindegyik típusból legalább egy.
4. **KALIBRÁCIÓ blokk**.
5. **SZOLGÁLAT A** — a HUD csak a hátralévő időt mutatja, semmi mást.
   Élő pontszám vagy találatszámláló **tilos**: az önmagában
   éberségfenntartó visszajelzés lenne, és pontosan azt a lejtést tüntetné
   el, amit mérünk.
6. **SZÜNET** — 20 s, kiírva: *„Nyújtózz egyet. A következő blokkban a rács
   lassan forogni fog.”*
7. **SZOLGÁLAT B**.
8. **EREDMÉNY** — hat sor (VR) / öt sor (sík):

| Sor | Példaérték |
|---|---|
| Észlelési érzékenység (*d′*) | `2,74` |
| Éberség-lejtés | `−9 pont / harmad` |
| Térbeli lefedettség | `287°` (entrópia `0,71`) |
| Lefedettség megtartása | `0,64` — *szűkülő felügyelet* |
| Hátsó szektor detekciója | `68%` (elöl `91%`) |
| Téves riasztás | `4` |

---

### Mobil vezérlés

Egyetlen **ELTÉRÉS** gomb a képernyő alján. Puszta koppintás is elegendő
volna, de ez éberségi feladat, ahol a téves riasztás a mérés fele: egy
markolatigazítás közbeni véletlen érintés hamis riasztásként landolna. A
dedikált gomb a jelenetet tisztán hagyja.

A rács mobilon eleve ±20°-ra szűkített, tehát minden a látómezőn belül van, és
fordulásra nincs szükség — a `look` ezért ebben a modulban ki van kapcsolva.

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az elrendezés a monoton ingerfolyamban ritka eltérést kereső
éberségi paradigmák szerkezetét követi (Mackworth-óra hagyomány), térbeli
kiterjesztéssel. A jelészlelés-elméleti feldolgozás (*d′*, kritérium) és a
harmadonkénti lejtésszámítás standard.

**Eltérések.** (a) A klasszikus feladat egyetlen, folyamatosan figyelt
ingerforrást használ; itt 32 forrás van, ami a feladatot részben vizuális
keresési feladattá is teszi. Ez szándékos — az operatív helyzet is ilyen —,
de azt jelenti, hogy a mért érték nem tisztán tartós figyelem, hanem
**térbeli felügyelet**. A metrikanevek ezt tükrözik.
(b) A folytonos feladatban a téves riasztás rátája konvención alapul
(lásd 7. fejezet), nem diszkrét zajpróbákon.
(c) 4 perces blokkok rövidek: a lejtés iránya kimutatható, a meredeksége
zajos. Kutatási felhasználáshoz a `WATCH_LONG` konfiguráció való.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3, 4 perces blokkok):
*d′* 2,0–3,5 · hit rate 0,70–0,92 · medián RT 700–1400 ms ·
téves riasztás 0–8 / 10 perc · lejtés −0,02 és −0,15 hit rate/harmad ·
lefedettség 180–330° · `scan_shrinkage` 0,55–0,95 ·
hátsó detekció 15–30 ponttal alacsonyabb az elülsőnél.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
alkalmasság őrszolgálatra, alvászavar, figyelemzavar vagy fáradtsági
állapot. A `scan_shrinkage` felkészítési célt jelöl ki, nem ítéletet.

**Tanulási hatás.** A detekciós képesség 2 felvétel után stabilizálódik.
A **pásztázási viselkedés erősen tanulható**: aki egyszer megtapasztalta,
hogy hátul is történnek események, a következő alkalommal többet fordul.
Ismételt méréskor a `scan_shrinkage` marad informatív, a nyers lefedettség
kevésbé. Az emitterek elrendezése és az eseménysorrend seedből generálódik.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. VR-ben az emitterek azimutja a teljes 360°-ot lefedi: minden 45°-os
   szektorban legalább 2 emitter.
2. Két emitter szögtávolsága soha nem kisebb 9°-nál.
3. Az emitterek szögmérete a távolságtól függetlenül 3,0° ± 0,15°.
4. Az események közti minimális távolság 4000 ms.
5. A válaszablak pontosan 2400 ms, és az ezen kívül érkező válasz
   `false_alarm` rekordot hoz létre.
6. Két azonos seedű futás azonos emitter-elrendezést, eseménysorrendet és
   eseményidőzítést ad.
7. Mérés közben semmilyen találat- vagy pontszám-visszajelzés nem jelenik meg.
8. Sík platformon az `audio` eseménytípus nem generálódik.
9. A blokkharmadok pontosan a blokk hosszának harmadai, és minden esemény
   pontosan egy harmadhoz tartozik.
10. A `scan_shrinkage` csak VR-ben számolódik; sík platformon a metrika
    hiányzik, nem nulla.
11. A 3. blokkban a rács forgása 2,2°/s ± 0,1, és a forgás nem mozdítja el
    a résztvevőt.
12. A *d′* soha nem `NaN` és nem végtelen, log-lineáris korrekcióval.
13. A modul kilépéskor minden emittert és panelt felszabadít.
14. Az eredményképernyő egyetlen sora sem tartalmaz `NaN`-t.
15. Szintetikus profilokon (éber / átlagos / lejtő) az OPS pontszám monoton
    csökkenő, legalább 180 pont különbséggel a szélsők között.
16. Egy „szűkülő felügyeletű” szintetikus profil (jó kezdeti detekció,
    erős `scan_shrinkage`) alacsonyabb pontszámot kap, mint egy azonos
    összesített hit rate-ű, de stabil lefedettségű profil.
