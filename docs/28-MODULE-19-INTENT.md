# 28 — MODUL 19 · INTENT · Mozgásolvasás & szándékfelismerés

**Kód:** `INTENT` · **Sorszám:** 19 · **Verzió:** 0.1.0
**Konfiguráció:** `INTENT_STANDARD_A` (alap), `INTENT_SHORT` (rövid)
**Platform:** VR · asztali · mobil — **eltérő blokkszámmal** (lásd 5.)
**Paradigmák:** biológiai mozgás / point-light display (Johansson, 1973),
az ellenfél mozdulatának időbeli takarása (temporal occlusion), megtévesztés-
felismerés
**Kapcsolódó dokumentumok:** `00-MASTER-SPEC.md` 5/19, `03-SPATIAL-DESIGN.md`

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban.** Az INTENT azt méri, **milyen korán tudja a felhasználó
megmondani, merre indul egy másik ember** — kizárólag a mozdulat
kinematikájából, mielőtt a mozdulat befejeződne.

Ez nem reakcióidő. Az elit sportoló nem gyorsabban *reagál* — **hamarabb
tud**. A modul fő mutatója ezért egy **időpont**: a legkorábbi takarási pont,
ahol a teljesítmény még megbízhatóan a véletlen felett van.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Honnan |
|---|---|---|
| Biológiai mozgás észlelése | Emberi mozdulat felismerése pusztán ízületi pontok mozgásából | Johansson point-light |
| Cselekvés-előrejelzés | A végkifejlet megjóslása a mozdulat befejezése előtt | temporal occlusion |
| Megtévesztés felismerése | A korai kinematika és a végkifejlet ellentmondásának kezelése | cselezés-paradigma |
| Kinematikai jelzések használata | Mely testrész mozgása hordozza az információt, és mikortól | — |
| Helyzetértékelés | Az előrejelzés összevetése a saját bizonytalansággal (katalógus 41) | confidence calibration |

### Amit a modul kifejezetten NEM mér

- **Nem méri a szándékot vagy a jellemet.** Egy absztrakt pontfény-alak
  irányváltását olvassa; ebből semmilyen következtetés nem vonható le
  emberek megítélésére, fenyegetőségére vagy szándékaira valós helyzetben.
- **Nem méri a reakcióidőt.** A válasz a takarás **után** érkezik, korlátozás
  nélküli időben. Aki lassan válaszol, de jól, jobb pontszámot kap.
- **Nem sportági alkalmasság.** A korai kinematikaolvasás sportágspecifikus:
  aki kapusként kiváló, kézilabdában nem feltétlenül az.
- **Nem méri az arcolvasást vagy az érzelemfelismerést.** Nincs arc, nincs
  mimika, nincs kontextus.
- **Nem használható biztonsági szűrésre.** Az A doménben szereplő
  „szándékfelismerés testtartásból” **analógia**, nem alkalmazás.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — sport (`primary`).** A korai kinematikai jelzések olvasása a
legjobban dokumentált szakértői előny a sportpszichológiában: az elit
kapus, vívó vagy teniszező nem gyorsabban mozdul, hanem hamarabb dönt.
Ez a modul közvetlenül ezt méri, és a `earliest_reliable_frame_ms`
összevethető a szakirodalmi takarásos vizsgálatok logikájával.
*Sportágak:* kapus, vívás, tenisz, küzdősportok, kosárlabda-védekezés.

**A — védelmi (`secondary`).** Ellenőrzőponton és tömegben a testtartás
korai jelei — a modul absztrakt analógiája ennek. **Másodlagos, és
kifejezetten óvatosan**: a valós helyzet kontextusfüggő, és a modul
eredményéből személyek megítélésére vonatkozó következtetés nem vonható le.
*Munkakörök:* ellenőrzőpont-szolgálat, személyvédelem, rendészet.

**B — munka (`secondary`).** Vezetés közben a gyalogos lelépési szándékának
korai felismerése ugyanez a konstruktum, más ingerrel.
*Munkakörök:* hivatásos sofőr, biztonsági szolgálat.

---

## 3. FELADATSTRUKTÚRA

### 3.1. Az inger: procedurális pontfény-alak

**13 gömb** az ízületek helyén: fej, két váll, két könyök, két csukló,
két csípő, két térd, két boka. Nincs test, nincs kontúr, nincs árnyék —
csak a pontok mozognak. Ez a Johansson-féle elrendezés: az emberi mozgás
felismeréséhez elég, minden más vizuális információt viszont elvesz.

**A mozdulat: irányváltás.** Az alak három fázisban indul oldalra:

| Fázis | Idő | Mit tesz | Mit hordoz |
|---|---|---|---|
| **Előkészítés** | 0–45% | súlyáthelyezés, törzsdőlés, karlendítés | a **korai jelzés** — ez lehet megtévesztő |
| **Elköteleződés** | 45–75% | a medence és a vezető láb a **végleges** irányba indul | az igazi információ |
| **Végrehajtás** | 75–100% | az egész alak eltolódik a végleges irányba | egyértelmű |

**Megtévesztés (cselezés).** A próbák **25%-ában** az előkészítés dőlése az
**ellenkező** irányba mutat, mint a végkifejlet. A maradék 75%-ban a kettő
egyezik. Az arány nem közölt, és a próbák kevertek — nincs „cselblokk”,
mert az elárulná magát.

**Takarás.** Az alak a mozdulat adott **hányadánál eltűnik**, és utána
semmi nem látszik. Négy takarási pont:

| Szint | Hányad | Idő (1400 ms-os mozdulatnál) | Mi látszott |
|---|---|---|---|
| 1 | 40% | 560 ms | csak az előkészítés — a csel itt olvashatatlan |
| 2 | 55% | 770 ms | az elköteleződés eleje |
| 3 | 70% | 980 ms | az elköteleződés java |
| 4 | 85% | 1190 ms | majdnem a teljes mozdulat |

### 3.2. Blokkok

| # | Blokk | Cél | Próbák | Gyakorlás | Platform |
|---|---|---|---|---|---|
| 1 | `frontal` | 4 takarás × 2 nézőpont × 6 | **48** | 6 | mind |
| 2 | `depth` | Felém indul vagy mellém? | **16** | 4 | **csak VR** |
| 3 | `peripheral` | Ugyanaz ±55°-on | **16** | 4 | **csak VR** |

**Idő:** VR-ben kb. 7 perc, sík platformon kb. 5.

`INTENT_SHORT`: `frontal` 32 próba (4 × 2 × 4), `depth` és `peripheral` 12-12.

### 3.3. A trial anatómiája

```
PREPARE          az alak alaphelyzetben, mozdulatlanul; 500 ms
COUNTDOWN        nincs — a mozdulat kezdete maga a jelzés
STIMULUS         a mozdulat lejátszása a takarási pontig (560–1190 ms)
                 a takarás pillanatában MINDEN pont eltűnik
RESPONSE WINDOW  korlátlan (a modul nem reakcióidőt mér)
RESPONSE         BAL vagy JOBB — a `depth` blokkban FELÉM vagy MELLÉM
FEEDBACK         csak gyakorlásban: a mozdulat befejeződik, és a helyes
                 irány felvillan
BIZTONSÁG        3 fokozatú magabiztosság: BIZTOS / TALÁN / TIPP
INTER-TRIAL      600 ms
```

**A magabiztosság minden próbán kötelező**, és a válasz **után** jön.
Előtte kérdezni befolyásolná a döntést; utána kérdezni a döntés
megítélését méri, ami a konstruktum része.

### 3.4. Eloszlások

- Irány: bal / jobb **kiegyensúlyozott** minden takarási szinten.
- Nézőpont: szemből / 55°-ról oldalról, kiegyensúlyozott.
- Csel: 25%, egyenletesen elosztva a takarási szintek között.
- A sorrend a futás seedjéből kevert, blokkonként.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szín |
|---|---|---|---|
| Ízületi pont | `sphere` | ø 0,032 m | `text`, önvilágító |
| Talajjelölő gyűrű | `torus` | ø 0,9 m | `textMuted` 20% |
| Válaszjelző (gyakorlás) | `arrow` | 0,3 m | `ok` / `bad` |

**Az alak mérete és helye.** Testmagasság 1,70 m, a résztvevőtől **3,2 m-re**,
szemmagasságban középre igazítva. Szögmagassága így 30,1° — testméretű, nem
képernyőméretű. Ez nem díszlet: a biológiai mozgás észlelése méretfüggő, és
egy 8°-os alak más feladat.

**A pontok mérete állandó szögméretű**: a `depth` blokkban, ahol az alak
közeledik, a gömbök fizikai átmérője a távolsággal skálázódik, hogy a
közeledést **kizárólag a diszparitás és a parallaxis** hordozza (lásd
`03-SPATIAL-DESIGN.md` 2.2).

### 4.1. A kinematikai modell

Nincs mozgásfelvétel. A tizenhárom pont pályája **paraméteres**:

```
lean(t)      = A_lean  · s1(t) · dirEarly        törzs- és fejdőlés
weight(t)    = A_wt    · s1(t) · dirEarly        csípő oldalirányú kitérése
arm(t)       = A_arm   · s1(t) · (−dirEarly)     ellenlendítés
pelvis(t)    = A_pelv  · s2(t) · dirFinal        az elköteleződés
step(t)      = A_step  · s2(t) · dirFinal        a vezető láb
body(t)      = A_body  · s3(t) · dirFinal        az egész alak eltolódása
```

ahol `s1`, `s2`, `s3` egymást követő, sima (minimum-jerk alakú) átmenetek a
0–45%, 45–75% és 75–100% szakaszokon, `dirEarly` a korai jelzés iránya
(cselnél `−dirFinal`), `dirFinal` a végkifejlet.

**Ez szándékosan paraméteres, nem felvett.** A manipulált változó maga a
kinematikai paraméter: a csel pontosan annyiban különbözik az igazitól,
hogy `dirEarly` előjelet vált — semmi más. Egy felvett mozdulatnál a két
feltétel száz apró dologban is különbözne, és nem tudnánk, melyik számított.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

### 5.1. Besorolás

| Feladatelem | Osztály | Indoklás |
|---|---|---|
| Bal/jobb előrejelzés | `equivalent` | a döntés nem térbeli, csak a jelzés az |
| Takarási időpont | `equivalent` | időzítés, minden platformon azonos |
| Nézőpont (szemből / oldalról) | `equivalent` | sík képernyőn is renderelhető |
| Magabiztosság | `equivalent` | — |
| **Mélységi szándék** | `vr-only` | állandó szögméret mellett a közeledést csak diszparitás és parallaxis hordozza |
| **Perifériás olvasás ±55°-on** | `vr-only` | a 75°-os vízszintes látómezőben nincs 55°-os periféria |

### 5.2. Platformonként kieső metrikák

| Metrika | vr | desktop | mobile |
|---|---|---|---|
| `depth_intent_accuracy`, `depth_earliest_frame_ms` | ✓ | — | — |
| `peripheral_intent_accuracy`, `peripheral_cost` | ✓ | — | — |
| `prediction_accuracy`, `earliest_reliable_frame_ms` | ✓ | ✓ | ✓ |
| `deception_susceptibility`, `confidence_calibration` | ✓ | ✓ | ✓ |
| `viewpoint_cost` | ✓ | ✓ | ✓ |

Sík platformon a `depth` és a `peripheral` blokk **nem fut**, a hozzájuk
tartozó súlyok kiesnek, a maradék négy átskálázódik, és a futás
`spatialWeightsApplied: false` értékkel rögzül.

### 5.3. `controlHint`

| Platform | Szöveg |
|---|---|
| VR | `BAL / JOBB RAVASZ: az irány · A gomb: magabiztosság` |
| asztali | `F vagy ← : bal · J vagy → : jobb` |
| mobil | `BAL / JOBB gomb, utána a magabiztosság` |

---

## 5/B. MOBIL VEZÉRLŐKÉSZLET

| Fázis | `buttons` | `dial` | `slider` | `look` | `hint` |
|---|---|---|---|---|---|
| Irányválasz | `BAL` (LEFT) · `JOBB` (RIGHT) | — | — | `off` | „Merre indult?” |
| Magabiztosság | `BIZTOS` · `TALÁN` · `TIPP` (ghost) | — | — | `off` | „Mennyire vagy biztos benne?” |

**Három állítás.**

1. **Két gomb, nem `dial`.** Kétirányú válasznál a dial felül és alul
   helyezne el két szegmenst, ami pont **nem** a bal-jobb kérdés alakja.
   A két gomb a valódi absztrakt `LEFT` / `RIGHT` akciót adja ki, tehát a
   modul kezelője platformfüggetlen marad.
2. **A magabiztosság külön képernyő, nem csúszka.** Három fokozat, három
   gomb: a csúszka folytonos értéket sugallna, amit nem tudunk értelmezni,
   és minden próbában plusz mozdulatot kívánna.
3. **`look: 'off'`.** A `depth` és a `peripheral` blokk mobilon nem fut,
   tehát nincs mit körbenézni; a takarás utáni válaszidőt pedig naplózzuk,
   és a húzás a `pointerup`-ig halasztaná a gombot.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Mi teszi nehezebbé.** A takarási pont korábbra hozása, a csel aránya, a
korai jelzés amplitúdója (`A_lean`, `A_wt`), a nézőpont és — VR-ben — az
excentricitás.

### `INTENT_STANDARD_A`

```
joints                 13
figureHeightM          1.70
figureDistanceM        3.20
movementMs             1400
occlusionFractions     0.40 · 0.55 · 0.70 · 0.85
frontalTrials          48      (4 takarás × 2 nézőpont × 6)
deceptionRatio         0.25
sideViewYawDeg         55
depthTrials            16      (VR)
peripheralTrials       16      (VR)
peripheralAzDeg        ±55
confidenceLevels       3
interTrialMs           600
reliableLevel          0.70
```

### `INTENT_SHORT`

```
frontalTrials          32
depthTrials            12
peripheralTrials       12
minden egyéb           azonos
```

### CHALLENGE mód

A takarási pont a teljesítményhez igazodik (3-lefelé-1-felfelé lépcső a
takarási hányadon), és élő pontszám látszik. **Az eredmény nem kerül
assessment normacsoportba**, mert a takarási pontok futásonként mások.

---

## 7. METRIKÁK

### 7.1. Nyers (próbánként)

| Név | Egység |
|---|---|
| `block` | `frontal` / `depth` / `peripheral` |
| `occlusion_fraction`, `occlusion_ms` | — / ms |
| `direction_final`, `direction_early` | −1 / +1 |
| `deceptive` | 0/1 |
| `viewpoint` | `front` / `side` |
| `az_deg` | fok (a `peripheral` blokkban) |
| `answer`, `correct` | −1/+1, 0/1 |
| `rt_ms` | ms — a takarástól a válaszig |
| `confidence` | 1 (tipp) … 3 (biztos) |

### 7.2. Származtatott

`prediction_accuracy` = a helyes válaszok aránya a **nem megtévesztő**
próbákon, a `frontal` blokkban. A cselek külön mutatóban: bevonva
összemosnák a korai olvasást a megtévesztés kezelésével.

`accuracy_by_occlusion` = négy érték, takarási szintenként.

**`earliest_reliable_frame_ms`** = az a takarási időpont, ahol az
`accuracy_by_occlusion` görbe felfelé keresztezi a **0,70**-es szintet,
lineáris interpolációval a két szomszédos pont között (a FIELD
`crossingPoint` eszközével). Ha a görbe a legkésőbbi takarásnál sem éri el
a 0,70-et, az érték **nem szám**, hanem „≥ 1190 ms”, és az eredményképernyő
így írja ki. Ha már a legkorábbi takarásnál felette van, „≤ 560 ms”.

**A 0,70-es szint indoklása.** 12 próba/szint mellett a 0,70 kb. 8,4/12
találat, ami egy 50%-os véletlenhez képest egyoldalú binomiálissal
p ≈ 0,073 — azaz **nem** szigorú szignifikancia. Ezt kimondjuk: a mutató
egy **küszöbátlépés**, nem statisztikai teszt, és a szórása egyetlen
futásban nagy. Több futás átlagában értelmezhető; egyetlen futásból
irányadó.

`deception_susceptibility` = `accuracy(genuine) − accuracy(deceptive)` a
**két késői** takarási szinten (0,70 és 0,85), ahol a csel elvileg
feloldható. A korai szinteken a csel tervezetten olvashatatlan, tehát
bevonva a mutató a feladat konstrukcióját mérné, nem a résztvevőt.

`viewpoint_cost` = `accuracy(front) − accuracy(side)`.

`confidence_calibration` = `accuracy(confidence=3) − accuracy(confidence=1)`.
Pozitív és nagy = tudja, mikor tudja.
`overconfidence` = `mean((confidence−1)/2) − accuracy`. Pozitív =
magabiztosabb, mint amennyire pontos.

`rt_median_ms` = a takarástól a válaszig eltelt idő mediánja. **Nem
pontozott**, csak leíró: a modul nem sebességet mér.

**VR-only.**
`depth_intent_accuracy` = a `depth` blokk pontossága.
`depth_earliest_frame_ms` = ugyanaz a küszöbátlépés a `depth` blokkban.
`peripheral_intent_accuracy` = a `peripheral` blokk pontossága.
`peripheral_cost` = `accuracy(frontal, azonos takarási szinteken) −
peripheral_intent_accuracy`.

### 7.3. Score (0–100) és horgonyok

| Score | Metrika | `good` | `poor` | Indoklás |
|---|---|---|---|---|
| `prediction_accuracy` | `prediction_accuracy` | 0,88 | 0,55 | 0,50 a véletlen; 0,55 alig felette |
| `early_reading` | `earliest_reliable_frame_ms` | 620 ms | 1190 ms | 620 ms az első takarási pont közelében van — aki ott már tud, kiemelkedő; 1190 = csak a végén |
| `deception_resistance` | `deception_susceptibility` | 0,05 | 0,40 | 0,40 = a cseleken 40 százalékponttal rosszabb, azaz gyakorlatilag bedől |
| `confidence_calibration` | `confidence_calibration` | 0,35 | 0,00 | 0 = a magabiztosság nem hordoz információt |
| `depth_intent` | `depth_intent_accuracy` | 0,85 | 0,55 | **VR-only** |
| `peripheral_reading` | `peripheral_cost` | 0,05 | 0,30 | **VR-only** |

Minden horgony **provizórikus**: a takarásos vizsgálatok szakirodalmi
értékei sportág- és ingerspecifikusak, és nem emelhetők át egy absztrakt
pontfény-alakra.

### 7.4. OPS SCORE összetevők

| Összetevő | Súly (VR) | Súly (sík) |
|---|---|---|
| `prediction_accuracy` | 0,28 | 0,34 |
| `early_reading` | 0,24 | 0,28 |
| `deception_resistance` | 0,18 | 0,21 |
| `confidence_calibration` | 0,14 | 0,17 |
| `depth_intent` | 0,09 | — |
| `peripheral_reading` | 0,07 | — |
| **Összeg** | **1,00** | **1,00** |

**Tengelypontszámok:** `perception` = prediction_accuracy és early_reading
átlaga; `spatial` = depth_intent és peripheral_reading átlaga (VR).

---

## 8. ESEMÉNYNAPLÓ

| Eseménytípus | Payload |
|---|---|
| `intent_setup` | `platform`, `blocks[]`, `joints`, `figureHeightM`, `figureDistanceM`, `movementMs`, `occlusionFractions`, `deceptionRatio`, `sideViewYawDeg`, `peripheralAzDeg`, `angularHeightDeg`, `quantisationMs` |
| `movement_start` | `trial`, `block`, `directionFinal`, `directionEarly`, `deceptive`, `viewpoint`, `azDeg`, `occlusionFraction`, `occlusionMs` |
| `occlusion` | `trial`, `t`, `framesShown` |
| `response` | `trial`, `answer`, `correct`, `rtMs`, `quantisationMs`, `source` |
| `confidence` | `trial`, `level`, `rtMs` |
| `block_summary` | `block`, `accuracyByOcclusion`, `deceptiveAccuracy`, `n` |

**Mozgásnaplózás: 5 Hz.** A fejpóz itt **nem** metrika: a résztvevő áll és
néz, a válasz gombnyomás. A fejmozgás csak azért kerül a naplóba, hogy
utólag ellenőrizhető legyen, nézett-e egyáltalán a `peripheral` blokk
ingerének irányába — ehhez 5 Hz elég.

**Az inger paraméterei minden próbán naplózódnak**, tehát a teljes
kinematika utólag újrajátszható a naplóból: nincs felvétel, amit tárolni
kellene, csak számok.

---

## 9. ADATBÁZIS

Nincs új tábla.

```json
stimulus: { "block": "frontal", "occlusionFraction": 0.55, "occlusionMs": 770,
            "directionFinal": 1, "directionEarly": -1, "deceptive": true,
            "viewpoint": "side", "azDeg": 0 }
response:  { "answer": -1, "rtMs": 940, "confidence": 2, "confidenceRtMs": 620 }
correct: false, outcome: "miss", reactionTimeMs: 940
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

**INTRO.**
> **INTENT — Mozgásolvasás**
> Egy alak — csak fénypontok az ízületein — elindul valamerre, aztán eltűnik.
> A kérdés: merre indult? Nem az a lényeg, hogy gyors legyél. Az, hogy
> **korán** tudd.
> **5–7 perc**

**INSTRUKCIÓ.**
> Az alak minden alkalommal elindul bal vagy jobb felé, és menet közben
> eltűnik. Néha korábban, néha később. Válaszolj nyugodtan — nincs időlimit.
>
> **Figyelem:** néha becsapnak. Az alak elindul egy irányba, aztán mégis a
> másikba megy. Ez a feladat része.
>
> Minden válasz után megkérdezem, mennyire voltál biztos benne.

**KALIBRÁCIÓ.** A testhelyzet rögzítése, majd egy teljes, **takaratlan**
mozdulat mindkét irányba, hogy a felhasználó lássa, hogyan néz ki egy
befejezett mozdulat.

**GYAKORLÁS.** 6 próba visszajelzéssel: a takarás után a mozdulat
befejeződik, és a helyes irány felvillan.

**MÉRÉS.** `frontal` → (VR: `depth` → `peripheral`).

**EREDMÉNY** (kiemelt sorok):

| Sor | Példaérték | Magyarázó |
|---|---|---|
| Előrejelzés pontossága | **81%** | a nem megtévesztő próbákon |
| Legkorábbi megbízható pont | **840 ms** | a mozdulat 60%-ánál már tudtad |
| Megtévesztésre | **−0,22** | a cseleken 22 százalékponttal rosszabb |
| Magabiztosság-kalibráció | **+0,31** | tudod, mikor tudod |
| Nézőpont ára | **0,08** | oldalról alig nehezebb |
| Mélységi szándék | **78%** | felém vagy mellém — *csak VR* |

**Ha a görbe sosem érte el a 0,70-et**, a második sor:
> **≥ 1190 ms** — *a leghosszabb takarásnál sem állt össze a kép*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Forrásparadigmák.** Johansson point-light display (1973) a
ingerreprezentációra; az ellenfél mozdulatának időbeli takarása
(temporal occlusion) a mérési logikára; a cselezés-paradigma a
megtévesztésre.

**Amiben eltérünk, és miért.**

1. **Paraméteres mozdulat felvétel helyett.** Ez erősség és korlát is.
   Erősség: a csel és az igazi próba **pontosan egy** paraméterben tér el,
   tehát a különbség oka egyértelmű. Korlát: a mozdulat nem valódi emberi
   mozgás, tehát a sportspecifikus szakértelem **nem feltétlenül**
   jelentkezik rajta. Ez a modul legfontosabb validálási kérdése, és a
   normagyűjtés első feladata.
2. **Absztrakt irány, nem sportági esemény.** Egy 11-es rúgás vagy egy
   tenisz-adogatás jobban mérné az adott sportág szakértelmét, de
   sportágfüggő lenne, és a platform három területet szolgál ki.
3. **A 0,70-es küszöb nem szignifikanciateszt.** Lásd 7.2.

**Elvárt nagyságrendek (becslés, kalibrálandó):**

| Metrika | Tartomány |
|---|---|
| `prediction_accuracy` | 0,60–0,92 |
| `earliest_reliable_frame_ms` | 620–1190 ms (vagy „≥ 1190”) |
| `deception_susceptibility` | 0,05–0,45 |
| `confidence_calibration` | 0,00–0,45 |
| `viewpoint_cost` | −0,05 … +0,20 |
| `depth_intent_accuracy` (VR) | 0,55–0,88 |
| `peripheral_cost` (VR) | 0,05–0,30 |

**Amit ebből NEM szabad kikövetkeztetni.** Emberek szándékának
megítélésére vonatkozó képességet valós helyzetben, sportági alkalmasságot,
vagy bármit egyetlen futásból a `earliest_reliable_frame_ms`-ról — az
egyetlen futásban zajos.

**Tanulási hatás.** A csel aránya és mintázata megtanulható: a 2.
felvételtől a résztvevő számít rá, és a `deception_susceptibility`
csökken — **nem** azért, mert jobban olvassa a kinematikát, hanem mert
tudja, hogy a korai jelzés néha hazudik. Az eredményképernyő az ismételt
felvételnél ezt kiírja. A `prediction_accuracy` és a
`earliest_reliable_frame_ms` stabilabb.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

| # | Állítás | Hogyan tesztelhető |
|---|---|---|
| 1 | A pontfény-alak pontosan 13 pontból áll, és minden pont pályája determinisztikus a próba paramétereiből. | A generált pozíciók ellenőrzése azonos paraméterekkel kétszer. |
| 2 | Egy megtévesztő és egy igazi próba **kizárólag** a `directionEarly` előjelében tér el, azonos többi paraméter mellett. | A két pályasorozat összevetése; az elköteleződési és végrehajtási fázis azonos. |
| 3 | A takarás pillanatában minden pont láthatatlan, és utána nem jelenik meg újra (gyakorláson kívül). | Szintetikus lejátszás; a láthatóság a takarás után hamis. |
| 4 | Az irány, a nézőpont és a takarási szint kiegyensúlyozott a `frontal` blokkban. | A generált próbalista megszámolása. |
| 5 | A csel aránya 0,25 ± 0,03, és egyenletesen oszlik a takarási szintek között. | Ugyanaz. |
| 6 | Két azonos seedű futás azonos próbalistát ad. | Két modul példány összehasonlítása. |
| 7 | A `earliest_reliable_frame_ms` egy monoton emelkedő, 0,70-et 900 ms-nál keresztező görbére 900-at ad ±30 ms-on belül. | Szintetikus pontossággörbe betáplálása. |
| 8 | Ha a görbe sosem éri el a 0,70-et, az érték **nem szám**, hanem a legkésőbbi takarás „≥” jelöléssel. | Szintetikus, végig 0,6-os görbe. |
| 9 | Ha a görbe már a legkorábbi takarásnál 0,70 felett van, az érték „≤ 560 ms”. | Szintetikus, végig 0,9-es görbe. |
| 10 | A `deception_susceptibility` **csak** a két késői takarási szintet használja. | Szintetikus futás, ahol a korai szintek cseljei mind hibásak; a mutató nem változik. |
| 11 | A `prediction_accuracy` **nem** tartalmazza a megtévesztő próbákat. | Szintetikus futás 100%-os igazi és 0%-os cselteljesítménnyel. |
| 12 | Sík platformon a `depth` és a `peripheral` blokk nem fut, és a négy hozzájuk tartozó metrika **hiányzik**. | Asztali és mobil futás blokk- és metrikalistája. |
| 13 | Sík platformon a négy OPS-súly összege 1,00, és `spatialWeightsApplied: false`. | Egységteszt mindkét súlylistára. |
| 14 | A `depth` blokkban a pontok szögmérete a közeledés alatt állandó ±3%-on belül. | A skálázás numerikus ellenőrzése. |
| 15 | A magabiztosság minden mért próbán rögzül, és három szintje van. | A generált trial rekordok ellenőrzése. |
