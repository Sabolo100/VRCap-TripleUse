# 20 — MODUL 12 · FIELD

**Hasznos látómező & dinamikus látásélesség**
`FIELD_STANDARD_A` · egyetlen változat · VR elsődleges, sík platformon szűkített

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a modul azt méri, hogy a résztvevő mekkora látómezőn belül
képes egy rövid felvillanás helyét megjelölni **anélkül, hogy a fejét
elfordítaná**, miközben egy központi azonosítási feladatot is végez — és hogy ez
a mező hogyan szűkül zavaró háttértől, mélységi eltéréstől és sebességtől.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Paradigma | Katalógus |
|---|---|---|---|
| Hasznos látómező | Az a látószögtartomány, amelyen belül egy rövid inger helye egyetlen fixáció alatt megjelölhető | Useful Field of View (Ball & Owsley) | — |
| Perifériás észlelés | Detekciós és lokalizációs pontosság excentricitás szerint | UFOV 2. altesztje | 17 |
| Megosztott figyelem | A központi és a perifériás feladat egyidejű teljesítése | UFOV 2. altesztje (dual task) | 23 |
| Dinamikus látásélesség | A legnagyobb szögsebesség, amelynél a célon lévő rés iránya még leolvasható | Dynamic visual acuity, Landolt-gyűrű | — |
| Látómező-szűkülés terhelés alatt | A perifériás pontosság esése zavaró háttér és mélységi konfliktus mellett | UFOV 3. altesztje (selective attention) | — |

### Amit kifejezetten NEM mér

- **Nem látásvizsgálat.** Nem mér refrakciós hibát, statikus látásélességet
  (Snellen), színlátást vagy szemészeti állapotot. Aki szemüveget visel, azzal
  végzi a tesztet; a modul a *figyelmi* mezőt méri, nem az optikait.
- **Nem szemmozgáskövetés.** A Quest 3 alapkonfigurációja nem ad szemkövetést,
  ezért a fixáció betartását **fejpózból** ellenőrizzük. Ez gyengébb feltétel:
  a résztvevő elmozdíthatja a tekintetét fejmozdulat nélkül. A modul ezt nem
  tudja kizárni, csak a fejfordulást — és ezt a korlátot az eredményképernyő
  kiírja.
- **Nem jogosít vezetői alkalmasságra.** A UFOV a balesetkockázat egyik
  validált előrejelzője populációs szinten; egyéni alkalmassági ítélet nem
  vezethető le belőle.
- **Nem agyrázkódás-diagnosztika.**

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** A „jó játéklátás" köznyelvi fogalma mérhető
tartalommal bír: mennyit vesz észre a játékos a periférián anélkül, hogy a
labdáról levenné a tekintetét. Ez pontosan a UFOV konstruktuma, és a
csapatsportokban a döntés minőségének felső korlátja — nem lehet jó passzt adni
oda, ahová nem néztünk. A mélységi altesztnek külön jelentése van: a pálya nem
egy sík, és a szabadon álló társ jellemzően más távolságban van, mint a labda.
*Példák: labdarúgó irányító, kosárlabda-átlövő, kézilabda-irányító, jégkorong
center, vízilabda-irányító.*

**B — Munka (elsődleges).** A UFOV a közúti balesetek egyik legerősebb validált
percepciós előrejelzője, különösen idősebb és fáradt vezetőknél. A zavaró
hátterű alteszt a valós forgalmi helyzet analógiája: a lényeges esemény
(kilépő gyalogos) egy vizuálisan zsúfolt mezőben jelenik meg.
*Példák: hivatásos sofőr, buszvezető, targoncás, darukezelő, idősvezetői
felülvizsgálat.*

**A — Védelem (másodlagos).** A látómező stressz alatti beszűkülése kiképzéssel
javítható, és a perifériás helyzetfelismerés a járőr- és harcoló beosztás
alapkészsége. Másodlagos, mert a védelmi kiválasztásban a PRESSURE modul
szűkülés-mérése (nyomás alatt) közvetlenebbül releváns; a FIELD a nyugalmi
mezőméretet adja hozzá.
*Példák: járőr, harcoló beosztás, konvojkísérés.*

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Próba | Gyakorlás | Idő |
|---|---|---|---|---|
| 1 | `threshold` — MEZŐ | 48 | 6 | ~3,0 perc |
| 2 | `cluttered` — ZSÚFOLT MEZŐ | 36 | 4 | ~2,4 perc |
| 3 | `depthfield` — MÉLYSÉGI MEZŐ | 32 | 4 | ~2,2 perc |
| 4 | `dva` — MOZGÓ CÉL | 28 | 4 | ~2,4 perc |

Teljes futás gyakorlással és instrukciókkal együtt **10–12 perc**.

### 3.1. A trial anatómiája — `threshold`, `cluttered`, `depthfield`

```
PREPARE          a központi fixációs gyűrű felizzik            600 ms
COUNTDOWN        —  (nincs; a fixáció maga a felkészülés)
STIMULUS         a központi alakzat ÉS a perifériás felvillanás
                 EGYSZERRE jelenik meg                          d ms (adaptív, 16–320)
                 (a perifériás inger utóképét maszk törli)      100 ms maszk
RESPONSE WINDOW  először a központi alakzat (2AFC),
                 majd a perifériás irány (8AFC)                 max 4000 ms
RESPONSE         két válasz, sorrendben                         —
FEEDBACK         csak gyakorlásban: helyes / helytelen          700 ms
INTER-TRIAL      véletlen szünet                                700–1300 ms
```

A központi feladat **először** válaszolandó. Ez szándékos: a UFOV eredeti
elrendezésében a központi azonosítás elsőbbsége biztosítja, hogy a résztvevő
tényleg a középre figyeljen, és a perifériás információt ne fixáció-váltással
szerezze meg.

**Adaptív időtartam.** A megjelenítési idő 3-lent-1-fent lépcsőn mozog
(három egymást követő teljesen helyes próba után rövidül, egy hiba után nő),
lépésköz **kezdetben ×0,75, hat fordulat után ×0,87**. Ez a 79%-os helyes
pontra konvergál. A küszöb az **utolsó nyolc fordulat mértani közepe**.
A kiindulási idő 320 ms, az alsó korlát a képfrissítés miatt **1 keret**
(Quest 3-on 11,1 ms; a ténylegesen kiadott időt keretszámra kerekítve
naplózzuk, nem a kért értéket).

### 3.2. Ingereloszlás

| Blokk | Excentricitás | Perifériás pozíciók | Disztraktor | Mélység |
|---|---|---|---|---|
| `threshold` | 10° / 20° / 35° / 50° | 8 irány (45°-onként) | nincs | mind 1,6 m |
| `threshold` — **kontrollpróba** | — (nincs felvillanás) | — | nincs | 1,6 m |
| `cluttered` | 10° / 20° / 35° / 50° | 8 irány | 24 gyűrű | mind 1,6 m |
| `depthfield` | 20° / 35° | 8 irány | nincs | fele 1,6 m, fele 5,2 m |
| `dva` | 0° (közeledő cél) | — | 12 gyűrű | 9,0 m → 1,2 m |

A `threshold` blokk 48 próbájából **minden hatodik (8 próba) kontrollpróba**:
csak a központi alakzat jelenik meg, perifériás felvillanás nélkül. Ez a UFOV
első altesztje, és **ez az egyetlen módja annak, hogy a `central_cost`
valóban kettősfeladat-költség legyen** — enélkül a kivonásnak nincs második
tagja. A maradék 40 próbán a négy excentricitás egyenlő arányban (10-10), a
nyolc irány kiegyensúlyozottan, a sorrend seedelt keveréssel.

A kontrollpróba **nem mozgatja a lépcsőt** (nincs perifériás válasz, amit
értékelni lehetne), és nem számít bele a perifériás pontosságba sem.

A `depthfield` blokk 32 próbája: 2 excentricitás × 2 mélység × 8 irány,
egyszer mindegyik.

### 3.3. A trial anatómiája — `dva`

```
PREPARE          indulási jelzés a távolban                     500 ms
STIMULUS         a gyűrű 9,0 m-ről közeledik, közben a saját
                 tengelye körül NEM forog (a rés iránya fix)    1,1–2,2 s
RESPONSE WINDOW  a rés iránya (4AFC: fent / lent / bal / jobb)  a gyűrű
                 megválaszolható, amíg 1,2 m-nél közelebb nem ér
RESPONSE         irány megadása                                 —
FEEDBACK         csak gyakorlásban                              600 ms
INTER-TRIAL                                                     600–1000 ms
```

A közeledési sebesség 3-lent-1-fent lépcsőn nő (helyes válasz után gyorsabb,
hiba után lassabb), így a **küszöbsebesség** ugyanazzal a logikával áll elő,
mint a `threshold` blokk küszöbideje.

---

## 4. INGERDEFINÍCIÓ

Kizárólag primitívek; külső 3D asset nincs.

| Elem | Primitív | Fizikai méret | Szögméret | Szín |
|---|---|---|---|---|
| Fixációs gyűrű | tórusz | 0,075 m, 1,6 m-en | **2,7°** | `accent` |
| Központi alakzat | kocka vagy gömb | 0,055 m, 1,6 m-en | **2,0°** | `text` |
| Perifériás cél | gömb | 0,10 m, 1,6 m-en | **3,6°** | fehér |
| Maszk | gyűrű | 0,16 m | 5,7° | `textMuted` |
| Disztraktor | tórusz | 0,10 m | 3,6° | `textMuted`, 0,55 opacitás |
| DVA-gyűrű | tórusz + kocka (réskitakaró) | 0,30 m átmérő | 1,9°→14,0° | `accent2` |

**A központi feladat** kétalternatívás: a fixációs gyűrű közepén **kocka vagy
gömb** jelenik meg. Szándékosan formaalapú és nem színalapú, mert a színt a
periférián is meg lehet ítélni, a formát nem — így a központi feladat valóban
fixációt kényszerít.

**A perifériás felvillanás** helyét nyolc irány közül kell megjelölni. A válasz
nem a cél megmutatása (az fejfordulást kívánna), hanem **egy nyolcállású
iránytárcsa** a fixációs pont körül, amit a résztvevő a kontroller
elfordításával vagy a nyílbillentyűkkel állít be — a fej mozdulatlan maradhat.

### 4/B. TÉRBELISÉG — A MODUL LÉTJOGOSULTSÁGA

> **Mi változna, ha az egész jelenetet lelapítanám egyetlen, a résztvevő elé
> helyezett gömbhéjra?**

Ez a modul kivételes eset: a laposítás nem *egy metrikát* venne el, hanem
**a mérés tartományát**. A hasznos látómező mérőszáma maga egy szögtartomány,
és egy sík kijelző fizikailag korlátozza, mekkora tartomány mérhető.

| Ami eltűnne | Miért |
|---|---|
| `peripheral_accuracy_35`, `peripheral_accuracy_50` | egy 60 cm-re lévő laptopképernyő ±16°-ot fed le; 35° és 50° nem jeleníthető meg |
| `field_radius_deg` | a mezősugár nem becsülhető olyan tartományon, amit nem tudunk ingerelni |
| `outer_field_ratio` | ugyanaz |
| `depth_field_cost` | egy héjon nincs két mélység |
| `fixation_break_rate` | sík kijelzőn nem tudjuk, elfordult-e a fej |
| `dva_threshold_dps` | a közeledés helyett oldalirányú mozgás marad, ami más konstruktum |

**Használt térbeli eszközök (a hatból négy):**

| Eszköz | Az ebből származó mérőszám | Pontozásban |
|---|---|---|
| **Körülvevő elrendezés** | `peripheral_accuracy_35/50`, `field_radius_deg`, `outer_field_ratio` | igen (0,26) |
| **Mélység önálló csatornaként** | `depth_field_cost` | igen (0,14) |
| **Közeledés és pálya** | `dva_threshold_dps` | igen (0,18) |
| **Forgás és tömör test** | — (higiéniai: a disztraktor-tóruszok forognak, hogy testek legyenek, ne minták) | nem |

**VR-only mutatók:** `peripheral_accuracy_35`, `peripheral_accuracy_50`,
`field_radius_deg`, `outer_field_ratio`, `depth_field_cost`,
`fixation_break_rate`, `dva_threshold_dps`.

**Szögméret-kompenzáció.** A `depthfield` blokkban a perifériás cél 1,6 m-en
0,10 m, 5,2 m-en **0,325 m** sugarú — a hányados pontosan a távolságok
hányadosa, tehát a **szögméret mindkét mélységben 3,6°**. E nélkül a „távoli"
egyszerűen „kisebbet" jelentene, és a mélységi alteszt méretmanipulációvá esne
össze. Ugyanez érvényes a `dva` blokk gyűrűjére: ott a szögméret
szándékosan nő, mert a közeledés maga az inger — de a **rés fizikai szélessége
állandó**, tehát a rés szögmérete a közeledéssel arányosan tágul, és a
küszöbsebesség értelmezhető marad.

**A fixáció ellenőrzése.** Minden próbában rögzítjük a fej tájolását a
felvillanás pillanatában és a válasz pillanatában. Ha a kettő között a
fejfordulás **6°-nál nagyobb**, a próba `fixation_break` jelzést kap, és
**kimarad a küszöbszámításból** — de a naplóban benne marad. Ez az egyetlen
módja annak, hogy a „hasznos látómező" ne legyen összekeverhető azzal, hogy
valaki egyszerűen odanézett.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Feladatelem | VR | Desktop | Mobil | Besorolás |
|---|---|---|---|---|
| Központi 2AFC | ravasz (kocka) / grip (gömb) | `Z` / `M` | két gomb | `equivalent` |
| Perifériás irány (8AFC) | iránytárcsa kontrollersugárral | nyílbillentyűk + Enter, vagy kattintás a tárcsán | koppintás a tárcsán | `equivalent` |
| DVA rés iránya (4AFC) | négy gomb a tárcsán | nyílbillentyűk | koppintás | `equivalent` |
| Excentricitás | 10 / 20 / 35 / 50° | 5 / 9 / 13 / 16° | 4 / 7 / 10 / 13° | **`adapted`** |
| Mélységi alteszt | 1,6 m vs 5,2 m | — | — | **`vr-only`** |
| Fixációellenőrzés | fejpózból | — | — | **`vr-only`** |
| DVA közeledés | 9,0 → 1,2 m | — | — | **`vr-only`** |

### Sík platformon kieső metrikák

`peripheral_accuracy_35`, `peripheral_accuracy_50`, `field_radius_deg`,
`outer_field_ratio`, `depth_field_cost`, `fixation_break_rate`,
`dva_threshold_dps`.

Ezek **hiányoznak**, nem nullák. A `field_size`, `depth_field` és
`dynamic_acuity` score-összetevők súlya sík platformon **0**, a maradék három
súly arányosan felskálázódik, és az eredményképernyő kiírja:
*„A látómező külső tartománya headset nélkül nem mérhető — a mezősugár és a
mélységi alteszt kimaradt."* A futás `spatialWeightsApplied: false` jelzést kap.

Sík platformon a modul **továbbra is érvényes UFOV-mérés** a belső mezőre
(`ufov_threshold_ms`, `central_cost`, `distractor_cost`) — csak szűkebb.

### `controlHint`

- **VR:** `RAVASZ: kocka · GRIP: gömb · majd a TÁRCSÁN az irány`
- **Desktop:** `Z: kocka · M: gömb · NYILAK: irány · ENTER: rögzít`
- **Mobil:** `BAL GOMB: kocka · JOBB GOMB: gömb · majd koppints az irányra`

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Amitől nehezebb:** rövidebb megjelenítési idő, nagyobb excentricitás, több
disztraktor, mélységi eltérés a központi feladat és a periféria között,
nagyobb közeledési sebesség.

| Paraméter | `FIELD_STANDARD_A` | `FIELD_SHORT` |
|---|---|---|
| `threshold` próbák | 48 | 28 |
| `cluttered` próbák | 36 | 20 |
| `depthfield` próbák | 32 | 16 |
| `dva` próbák | 28 | 16 |
| Excentricitások | 10 / 20 / 35 / 50° | 10 / 35° |
| Disztraktorszám | 24 | 16 |
| Küszöb-fordulatok | 8 | 5 |
| Becsült idő | 10–12 perc | 6 perc |

**CHALLENGE mód.** A lépcső nem áll meg a küszöbnél, hanem a helyes válaszok
után tovább gyorsul, és a pontszám a legjobb sorozat. Ez motivációs
üzemmód; az eredménye **nem kerül egy normacsoportba** az assessment
futásokkal, mert a lépcső eltérő szabálya más pszichometriai pontra konvergál.

---

## 7. METRIKÁK

### Nyers (próbánként)

| Mező | Egység |
|---|---|
| `durationMs` (ténylegesen kiadott, keretre kerekítve) | ms |
| `eccentricityDeg`, `directionIndex` (0–7) | fok, index |
| `centralShape` (`cube`/`sphere`), `centralCorrect` | — |
| `peripheralAnswer`, `peripheralCorrect` | index |
| `depthM` | m |
| `headYawAtOnset`, `headYawAtResponse`, `headMoveDeg` | fok |
| `fixationBreak` | logikai |
| `approachSpeedMps`, `gapDirection`, `gapCorrect` (dva) | m/s, index |

### Származtatott

| Metrika | Definíció | Egység |
|---|---|---|
| `ufov_threshold_ms` | az utolsó 8 lépcsőfordulat **mértani közepe** a `threshold` blokkban, a `fixation_break` próbák kizárásával | ms |
| `cluttered_threshold_ms` | ugyanez a `cluttered` blokkban | ms |
| `distractor_cost` | `cluttered_threshold_ms − ufov_threshold_ms` | ms |
| `peripheral_accuracy_10/20/35/50` | a perifériás irány helyes megjelölésének aránya excentricitásonként, a küszöbnél hosszabb próbákat is beleértve | arány |
| `field_radius_deg` | az az excentricitás, ahol a perifériás pontosság a 0,5 szintet metszi, a négy pont közötti lineáris interpolációval; ha 50°-on is 0,5 fölött van, `≥50` | fok |
| `outer_field_ratio` | `peripheral_accuracy_50 / peripheral_accuracy_10` | arány |
| `central_accuracy_single` | a központi feladat pontossága a **kontrollpróbákon** (nincs perifériás inger) | arány |
| `central_accuracy_dual` | ugyanez azokon a próbákon, ahol perifériás felvillanás is volt | arány |
| `central_cost` | `central_accuracy_single − central_accuracy_dual` — a kettősfeladat ára | arány |
| `depth_field_cost` | azonos mélységű és eltérő mélységű perifériás pontosság különbsége | arány |
| `dva_threshold_dps` | a küszöbsebesség szögsebességre átszámítva a válasz pillanatában | fok/s |
| `fixation_break_rate` | a 6°-nál nagyobb fejfordulással járó próbák aránya | arány |

### Score-összetevők

| Összetevő | Képlet | `good` | `poor` | Súly (VR) | Súly (sík) |
|---|---|---|---|---|---|
| `field_size` | `field_radius_deg` | 50° | 18° | 0,26 | **0** |
| `threshold_speed` | `ufov_threshold_ms` | 40 ms | 220 ms | 0,24 | 0,44 |
| `divided_attention` | `1 − central_cost` | 0,98 | 0,72 | 0,18 | 0,33 |
| `dynamic_acuity` | `dva_threshold_dps` | 60°/s | 12°/s | 0,18 | **0** |
| `depth_field` | `1 − depth_field_cost` | 0,97 | 0,70 | 0,14 | **0** |
| `clutter_resistance` | `distractor_cost` | 10 ms | 120 ms | — | 0,23 |

A `clutter_resistance` VR-ben a `threshold_speed`-be van beépítve
(a két küszöb átlaga), sík platformon önálló összetevőként jelenik meg, hogy a
maradék súlyok kiadják az 1-et. VR: 0,26+0,24+0,18+0,18+0,14 = **1,00**.
Sík: 0,44+0,33+0,23 = **1,00**.

A horgonyértékek **provizórikusak**: a UFOV klasszikus küszöbei 15–500 ms
között szórnak életkor szerint, de headsetben, kontrollerválasszal, más
maszkolással nem közvetlenül átvihetők. Az első 200 futás után újra kell
kalibrálni; addig a pontszám relatív rangsorolásra használható, abszolút
minősítésre nem.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `field_geometry` | `platform`, `eccentricities[]`, `directions`, `depthsM[]`, `fixationToleranceDeg` |
| `fixation_ready` | `headYawDeg`, `headPitchDeg` |
| `stimulus_onset` | `durationMs`, `frames`, `eccentricityDeg`, `directionIndex`, `depthM`, `centralShape`, `distractors`, `quantisationMs` |
| `mask_onset` | `tAfterStimulusMs` |
| `central_response` | `answer`, `correct`, `rtMs` |
| `peripheral_response` | `answer`, `correct`, `rtMs`, `errorDirections` (0–4 lépés a tárcsán) |
| `fixation_break` | `headMoveDeg`, `phase` |
| `staircase_step` | `block`, `fromMs`, `toMs`, `reversal`, `reversalIndex` |
| `dva_trial` | `speedMps`, `angularSpeedDegPerSec`, `gapDirection`, `answer`, `correct`, `distanceAtResponseM` |
| `block_summary` | `block`, `thresholdMs`, `reversals`, `validTrials`, `fixationBreaks` |

**Motion logging: 20 Hz.** Elég ahhoz, hogy a fixáció megtartása utólag is
ellenőrizhető legyen (egy 6°-os fejfordulás jellemzően 150–300 ms alatt zajlik,
tehát 20 Hz-en 3–6 mintát ad), és nem több, mert a kéz helye ebben a modulban
nem hordoz információt.

---

## 9. ADATBÁZIS

Nincs új tábla. A `trials` sorokba:

`stimulus`: `{ block, durationMs, frames, eccentricityDeg, directionIndex, depthM, centralShape, distractorCount, approachSpeedMps?, gapDirection?, platform }`

`response`: `{ centralAnswer, centralCorrect, peripheralAnswer, peripheralCorrect, errorDirections, rtCentralMs, rtPeripheralMs, headMoveDeg, fixationBreak, gapAnswer?, gapCorrect?, distanceAtResponseM? }`

`outcome`: `hit` (mindkét válasz helyes) · `miss` (perifériás hibás) ·
`false_alarm` (központi hibás) · `invalid` (fixációtörés) · `timeout`.

A `metrics` táblába a 7. fejezet minden származtatott mutatója bekerül; a
VR-only mutatók sík platformon **nem kapnak sort** (nem nulla értékkel, hanem
hiányzóként).

---

## 10. FELHASZNÁLÓI FOLYAMAT

**Intro.** „FIELD — Hasznos látómező. Mennyit veszel észre a szemed sarkából
anélkül, hogy odanéznél?"

**Instrukció (1. blokk).** „Középen egy gyűrű lesz. **Végig azt nézd.** A gyűrű
közepén egy pillanatra megjelenik egy KOCKA vagy egy GÖMB — ezt kell először
megmondanod. Ugyanabban a pillanatban valahol oldalt is felvillan valami: utána
azt kell megjelölnöd, merre volt. Ne fordítsd oda a fejed — a lényeg épp az,
hogy mennyit veszel észre odanézés nélkül."

**Kalibráció.** A résztvevő a fixációs gyűrűre néz, és megnyomja a ravaszt.
Ekkor rögzítjük a **nyugalmi fejtájolást**, amihez a későbbi fejmozgás
mérődik. Szöveg: „Nézz a gyűrűre, és nyomd meg a ravaszt. Innentől ez a
kiindulási irány."

**Gyakorlás.** 6 próba visszajelzéssel, fix 320 ms megjelenítéssel. Ha a
gyakorlásban a fixációtörések aránya meghaladja a 40%-ot, a rendszer megismétli
a gyakorlást egyszer, ezzel a szöveggel: „Nagyon jó a válasz, de közben
elfordítod a fejed. Próbáld végig a gyűrűn tartani a tekinteted."

**„Most jön a mérés."** „Innentől nincs visszajelzés, és a felvillanás egyre
rövidebb lesz. Ez normális — addig rövidül, amíg meg nem találjuk a határodat."

**Eredményképernyő (6 sor).**

| Sor | Példaérték |
|---|---|
| Hasznos látómező sugara | `42°` — *eddig veszed észre a felvillanást* |
| Küszöbidő | `78 ms` — *ennyi elég a felismeréshez* |
| Zsúfolt háttér ára | `+46 ms` |
| Megosztott figyelem | `94%` — *a központi feladat pontossága* |
| Mélységi mező ára | `−9 pont` — *más távolságban gyengébb* |
| Mozgó cél | `34°/s` — *eddig olvasható a rés* |

Ha a fixációtörések aránya > 25%, a hatodik sor helyére figyelmeztetés kerül:
**„FIGYELEM: a próbák 31%-ában elfordult a fej — a mezősugár túlbecsült lehet."**

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Ball és Owsley Useful Field of View eljárása (központi
azonosítás + perifériás lokalizáció + szelektív figyelem zavaró háttérrel).
A mélységi alteszt a figyelmi mező mélységi korlátozottságának irodalmára épül
(a figyelem nem terjed ki egyformán minden távolságra). A DVA-blokk a dinamikus
látásélesség Landolt-gyűrűs eljárásának közeledéses változata.

**Eltérés az eredetitől.** (1) Az eredeti UFOV három altesztje fix
megjelenítési idővel dolgozik, itt adaptív lépcső van, ami pontosabb egyéni
küszöböt ad ugyanannyi próbából. (2) Az eredeti maximális excentricitása
30°, itt 50° — mert headsetben ez elérhető, és a sportbeli „játéklátás"
tartománya ennél is szélesebb. (3) Az eredeti nem tudja ellenőrizni a
fixációt; itt fejpózból ellenőrizzük, ami gyengébb a szemkövetésnél, de
lényegesen jobb a semminél.

**Elvárt nagyságrend** egészséges fiatal felnőttnél VR-ben (becslés, kalibrálás
előtt): `ufov_threshold_ms` 50–120 ms, `field_radius_deg` 35–50°,
`distractor_cost` 20–90 ms, `central_cost` 0,02–0,10,
`depth_field_cost` 0,04–0,15, `dva_threshold_dps` 25–55°/s.

**A rövid lépcső ismert torzítása.** 48 próbából a küszöbbecslés szimulációban
**mintegy 12%-kal felfelé torzít** (80 ms-os igazi küszöbre 89,8 ms átlag,
17,3 ms szórással, 40 szimulált résztvevőn — `tests/psychophysics.test.ts`).
Ez a transzformált lépcsők ismert kis mintás viselkedése, és **nem hiba**: a
torzítás minden résztvevőnél azonos irányú, tehát az egyének közötti
összehasonlítást nem rontja. Abszolút küszöbérték közléséhez viszont
korrekciót igényel, és ezt a normatábla feltöltésekor kell elvégezni.

**Amit nem szabad kikövetkeztetni.** Egyéni vezetői vagy sportbeli
alkalmasságot; szemészeti állapotot; hogy a szűk mező javíthatatlan (a UFOV
bizonyítottan tréningezhető, ami épp az érték: a modul a tréning
hatásmérésére is alkalmas).

**Tanulási hatás.** A küszöb a 2. felvételre jellemzően 10–20%-kal javul
(feladatismeret), majd stabilizálódik. A `field_radius_deg` stabilabb, a
`distractor_cost` a legérzékenyebb a gyakorlásra. Ismételt méréshez az
5. felvételtől érdemes normát számolni, és a 2. felvétel előtti értéket
alapvonalnak tekinteni, nem eredménynek.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. **A tényleges megjelenítési idő keretszámra kerekített**, és a naplóban a
   kiadott (nem a kért) érték szerepel. *Teszt: a `frames × frameInterval` és a
   `durationMs` eltérése < 0,5 ms.*
2. **A küszöb az utolsó 8 fordulat mértani közepe**, és a fixációtöréses próbák
   nem számítanak fordulatnak. *Teszt: szintetikus válaszsorozat ismert
   küszöbbel, ±8% tűréssel visszanyerve.*
3. **A `depthfield` blokk két mélységében a cél szögmérete 0,2 fokon belül
   megegyezik.** *Teszt: `2·atan(r/d)` a két (r, d) párra.*
4. **Sík platformon a `field_radius_deg` és a `depth_field_cost` hiányzik**, nem
   nulla, és a score-súlyok átskálázódnak 1,00-ra. *Teszt: a metrikalista nem
   tartalmazza a nevet; a súlyok összege 1.*
5. **A perifériás válasz nem igényel fejfordulást**: a tárcsa a fixációs ponttól
   számított 8°-on belül van. *Teszt: a tárcsa geometriájának szögmérete.*
6. **A 6°-nál nagyobb fejfordulással járó próba `invalid` kimenetet kap**, és
   kimarad a küszöbszámításból, de a naplóban benne marad. *Teszt: szimulált
   fejmozgás egy próbában.*
7. **Két azonos seedű futás azonos irány-, mélység- és formasorrendet ad.**
   *Teszt: két `Rng(42)` futás összehasonlítása.*
8. **A `threshold` blokkban a négy excentricitás egyenlő számú próbát kap**
   (48 / 4 = 12), és a nyolc irány kiegyensúlyozott. *Teszt: darabszámlálás.*
9. **A DVA-gyűrű résének fizikai szélessége a közeledés alatt állandó.**
   *Teszt: a rés szélessége minden kereten ugyanaz a méter érték.*
10. **Egy `FIELD_SHORT` futás 7 percnél nem tart tovább.** *Teszt: a
    próbaszámok és a fázisidők összege.*
11. **A központi válasz mindig megelőzi a perifériásat**; a fordított sorrend
    nem elfogadható. *Teszt: az iránytárcsa csak a központi válasz után jelenik meg.*
11/b. **A `threshold` blokk próbáinak hatoda kontrollpróba**, ezek nem mozgatják
    a lépcsőt, és nem számítanak a perifériás pontosságba. *Teszt:
    `tests/sport-modules.test.ts` — a kontrollpróbák hozzáadása nem változtatja
    meg a `peripheral_accuracy_10` értékét.*
12. **A modul soha nem kér 45°-nál nagyobb elevációjú célt** (nyaki kényelem és
    kinetózis miatt). *Teszt: az elevációtartomány ellenőrzése.*
