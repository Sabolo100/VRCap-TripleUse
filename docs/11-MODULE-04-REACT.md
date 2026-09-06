# 11 — MODUL 04: REACT
## Reakcióidő & pszichomotoros kontroll — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/react/ReactModule.ts`
**Támogatott platformok:** VR · asztali · mobil
**Névleges időtartam:** ~7 perc (gyakorlással együtt ~9 perc)
**Doménkötés:** A elsődleges · B elsődleges · C elsődleges

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a REACT azt méri, mennyi idő telik el egy inger megjelenése és
a rá adott motoros válasz között, és mennyire pontosan, simán és stabilan
kivitelezett ez a válasz.

A modul azért az első implementált egyszemélyes modul, mert a szenzomotoros lánc
minden rétegét külön blokkban izolálja, és közben a platform minden alrendszerét
használatba veszi: primitívek, jelrendszer, mozgásrendszer, input absztrakció,
időzítés, naplózás, pontozás, keresztplatform leképezés.

### Mért konstruktumok

| Konstruktum | Katalógus # | Melyik blokk |
|---|---|---|
| Egyszerű reakcióidő | 31 | 1 |
| Választásos reakcióidő | 32 | 2 |
| Feldolgozási sebesség | 9 | 1, 2 |
| Szem–kéz koordináció | 33 | 3 |
| Finommotoros pontosság | 37 | 3 |
| Célkövetés | 36 | 4 |
| Kétkezes koordináció | 38 | 5 |
| Szenzomotoros integráció | 40 | 3, 4 |
| Sebesség–pontosság egyensúly | 134 | 2 |

### Amit a modul NEM mér

- **Nem méri a fáradtságot** — a lapszus-arány érzékeny rá, de egyetlen felvételből
  fáradtságot állítani nem szabad. Ahhoz ugyanannak a személynek több felvétele kell.
- **Nem méri a figyelmet** általában. Az egyszerű reakcióidő éberségi komponenst
  tartalmaz, de a tartós figyelem a WATCH dolga.
- **Nem méri az intelligenciát.** A feldolgozási sebesség korrelál vele, de az
  együttjárás nem azonosság.
- **Nem ad idegrendszeri diagnózist.** Az emelkedett tremor vagy a szélsőségesen
  magas RT-szórás jelzés lehet, de kizárólag orvosi kivizsgálásra utaló *jelzés*.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** Minden időkritikus feladat alsó korlátja. A leginkább
használható mutató nem az átlagos reakcióidő, hanem a **szórása**: az alváshiány
és a fáradtság sokkal hamarabb jelenik meg a variabilitásban és a lapszusokban,
mint az átlagban. Beosztások: járművezető, légvédelmi kezelő, gyakorlatilag minden
harcoló beosztás.

**B — Munkaalkalmasság (elsődleges).** A vezetői alkalmasság klasszikus magja. A
lapszus-arány (>500 ms válaszok) a műszakos fáradtság legjobb rövid indikátora,
és ezért műszak eleji/végi összehasonlításra is alkalmas. Munkakörök: gépjárművezető,
mozdonyvezető, daruvezető, műszakos operátor, sürgősségi ellátás.

**C — Sport (elsődleges).** Rajtreakció, ütés-elhárítás, labdakövetés. A negyedik
blokk (folyamatos követés) a zárt hurkú vizuomotoros kontrollt méri, ami
sportágcsoportot jól elkülönít: az ütősportok magas követési pontosságot és
alacsony késést kívánnak, a ciklikus sportágak inkább stabilitást.
Sportágak: sprint, asztalitenisz, vívás, ökölvívás, motorsport.

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | EGYSZERŰ REAKCIÓ | 5 | 24 | ~2:00 | detekció + motoros késés |
| 2 | VÁLASZTÁSOS REAKCIÓ | 6 | 28 | ~1:40 | + döntési szakasz |
| 3 | CÉLRA MUTATÁS | 4 | 20 | ~1:30 | mozdulatindítás, kivitelezés, végpontpontosság |
| 4 | FOLYAMATOS KÖVETÉS | 1 | 3 × 22 s | ~1:30 | zárt hurkú kontroll |
| 5 | KÉT KÉZ | 6 | 26 | ~1:40 | kétkezes koordináció, kézaszimmetria |

### 3.1. Blokk 1 — Egyszerű reakció

Egyetlen gömb a látómező közepén (0, 1,60, −2,20 m), tompa szürke. Az inger a
gömb felvillanása: szín az arculati kiemelőre vált, fényerő 2,2-szeresére ugrik
180 ms-ra, a méret 0,28 → 0,34 m-re nő 120 ms alatt.

```
PREPARE          1400–4200 ms   exponenciális eloszlásból (nem egyenletes!)
COUNTDOWN        0
STIMULUS         max 1500 ms    válaszra vár
RESPONSE         0              a válasz beérkezésekor
FEEDBACK         700 ms gyakorláskor, 0 mérés közben
INTER-TRIAL      250 / 380 ms
```

**Miért exponenciális az előidő?** Egyenletes eloszlásnál a résztvevő megtanulja,
hogy „most már mindjárt”, és elkezd találgatni. Az exponenciális eloszlás
memóriamentes: a várakozás hossza nem árulja el, mikor jön az inger.

**Korai válasz.** Az inger előtti válasz **false start**, nem gyors reakció.
A próba `invalid` kimenettel zárul, a felhasználó „TÚL KORAI” visszajelzést kap
gyakorlás közben, és a false start külön metrikaként számolódik.

### 3.2. Blokk 2 — Választásos reakció

Ugyanaz a gömb, de piros vagy kék (50–50%, seedelt). Piros → bal oldali válasz,
kék → jobb oldali válasz. A hibás oldal `false_alarm`.

A blokk lényege nem az abszolút RT, hanem a **döntési többletidő**:
`decision_cost = median(choice RT) − median(simple RT)`. Ez az a szakasz, ami az
első blokkhoz képest hozzáadódott, tehát tisztábban köthető a döntéshez, mint egy
önmagában álló választásos RT.

### 3.3. Blokk 3 — Célra mutatás

Egy célgyűrű jelenik meg 2,2 m-re, véletlen azimuton és elevatión. A gyűrű
átmérője próbáról próbára változik (három szintben), az amplitúdó a mutató
aktuális irányától függ — így a **nehézségi index** (`log2(2A/W)`) próbánként más,
és a reakcióidő ellene regresszálva Fitts-meredekséget ad.

Rögzített részidők:
- **mozdulatindítás** (`movement_initiation`) — az első frame az inger után, ahol
  a mutató szögsebessége meghaladja az 1,5°/frame küszöböt,
- **mozdulatidő** (`movement_time`) — indítástól a megerősítésig,
- **végponthiba** (`endpoint_error`) — a mutató és a cél középpontja közti szög
  a megerősítés pillanatában,
- **útvonal-hatékonyság** — a cél szögtávolsága osztva a mutató bejárt szögútjával.

**A platformfüggő geometria itt a legfontosabb** — lásd 5. fejezet.

### 3.4. Blokk 4 — Folyamatos követés

Egy gömb Lissajous-pályán mozog (22 s, próbánként növekvő sebességgel:
0,34 / 0,46 / 0,58 rad/s). A frekvenciaarány irracionálishoz közeli
(1 : 1,61 ± 0,12), tehát a pálya sima, de nem tanulható meg.

Nincs gombnyomás. Minden frame-ben mérjük a mutató és a cél iránya közti szöget.
A gömb színe zöldre vált, amíg 3,2°-on belül van — ez az egyetlen élő visszajelzés
a mérés alatt, és azért megengedett, mert nélküle a feladat nem elvégezhető
(a résztvevő nem tudná, hol a tűrés).

### 3.5. Blokk 5 — Két kéz

Két gömb (bal és jobb). Az egyik, a másik, vagy **mindkettő** villan fel
(40% / 40% / 20%). Egyoldali ingernél a másik oldal megnyomása `false_alarm`.
Kétoldalinál mindkét kéz válasza kell; a próba akkor zárul, amikor a második
megérkezik, és rögzítjük a kettő közti **aszinkróniát**.

A kézaszimmetria (`hand_asymmetry`) a bal és jobb oldali medián RT különbsége.
Jobbkezeseknél tipikusan kis pozitív érték; a szokatlanul nagy aszimmetria
érdekes, de önmagában nem értelmezhető.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szögméret 2,2 m-ről | Szín |
|---|---|---|---|---|
| Központi gömb | sphere | 0,28 → 0,34 m | 7,3° → 8,8° | `#2B3646` → arculati kiemelő |
| Választásos gömb | sphere | 0,34 m | 8,8° | `#FF4D4D` / `#3D9DFF` |
| Célgyűrű | ring + mag | változó | 3,2 / 4,6 / 6,4° | arculati kiemelő |
| Követett gömb | sphere | 0,20 m | 5,2° | kiemelő → `ok` zöld célon |
| Oldalsó gömbök | sphere | 0,24 → 0,30 m | 6,2° → 7,8° | `#2B3646` → kiemelő |

**Hang.** Az inger megjelenésekor rövid 1400 Hz-es kattanás (28 ms). Gyakorlás
közben helyes válaszra 880 Hz (90 ms), hibásra 180 → 120 Hz lefutó négyszög
(180 ms). Mérés közben csak a kattanás szól. Minden hang futásidőben
szintetizálódik, nincs audio asset.

**Haptika.** Helyes válaszra 25 ms / 0,3 erősség, hibásra 70 ms / 0,6 azon a
kézen, amelyik válaszolt. **Nem mérési csatorna** — böngésző- és hardverfüggő,
ezért soha nem hordoz egyedüli információt.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1 Egyszerű | `equivalent` | Csak az időzítés számít. |
| 2 Választásos | `equivalent` | Két diszkrét válasz, minden platformon van kettő. |
| 3 Célra mutatás | `adapted` | A szögtartománynak el kell férnie a viewportban. |
| 4 Követés | `adapted` | Az amplitúdónak el kell férnie; érintésen csak lenyomva működik. |
| 5 Két kéz | `equivalent` | `F`/`J`, illetve bal/jobb képernyőharmad. |

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Mutatás azimut | ±42° | ±26° | ±20° |
| Mutatás elevatio | +20° / −16° | +14° / −12° | +12° / −10° |
| Célméretek | 3,2 / 4,6 / 6,4° | 3,6 / 5,2 / 7,0° | 5,0 / 6,5 / 8,5° |
| Követés amplitúdó | 1,05 × 0,42 × 0,18 m | 0,72 × 0,34 × 0,12 m | 0,50 × 0,30 × 0,10 m |
| Oldalsó gömbök | ±0,62 m | ±0,50 m | ±0,50 m |
| Panel távolság | 1,9 m | 1,35 m | 1,35 m |

Minden próba rögzíti a használt `spreadDeg` és `platform` értéket, tehát az
elemzés utólag is tudja, milyen feladatot kapott a résztvevő.

### Platformonként kieső metrikák

| Metrika | VR | Asztali | Mobil |
|---|---|---|---|
| `movement_initiation` | ✓ | ✓ | **nem értelmezhető** (nincs hover) |
| `path_efficiency` | ✓ | ✓ | **nem értelmezhető** |
| `time_on_target` | ✓ | ✓ | ✓, de érintésmentes szakaszok kizárva |
| `hand_asymmetry` | ✓ (két kontroller) | részleges (két billentyű) | részleges (két hüvelykujj) |

### Irányítási szöveg (`controlHint`) platformonként

| Blokk | VR | Asztali | Mobil |
|---|---|---|---|
| 1 | „Húzd meg bármelyik ravaszt, amint a gömb felvillan.” | „Kattints vagy nyomd meg a SZÓKÖZT…” | „Koppints bárhol a képernyőn…” |
| 2 | „PIROS → bal ravasz, KÉK → jobb ravasz.” | „PIROS → F vagy balra nyíl…” | „PIROS → bal harmad, KÉK → jobb harmad.” |
| 3 | „Irányítsd a sugarat a gyűrű közepére, majd ravasz.” | „Vidd az egeret a gyűrű közepére és kattints.” | „Koppints a gyűrű közepére.” |
| 4 | „Tartsd a sugarat a gömbön. Nem kell gombot nyomni.” | „Kövesd a gömböt az egérrel.” | „Tartsd az ujjad a képernyőn és kövesd.” |
| 5 | „Bal gömb → bal ravasz, jobb → jobb.” | „Bal gömb → F, jobb gömb → J.” | „Bal / jobb képernyőharmad, mindkettőnél két ujj.” |

---

## 6. IDŐZÍTÉSI PONTOSSÁG

Ez a modul áll vagy bukik azon, hogy a két időbélyeg honnan jön.

**Inger megjelenése.** A render loop `time` paramétere, ami immerzív
munkamenetben a frame **előrejelzett megjelenítési ideje** — nagyjából az a
pillanat, amikor a foton a szembe ér. Nem `performance.now()` a rajzoláskor.

**Válasz.** DOM-eseménynél az `event.timeStamp`, amely a böngésző eseménykezelése
előtt keletkezik, tehát nem tartalmazza a JS-feldolgozás késleltetését. XR
kontrollergomboknál viszont frame-enkénti pollozás, tehát a felbontás egy
frame-idő. Ezt minden esemény mellé beírjuk `quantisationMs` néven
(Quest 3 / 90 Hz esetén ≈ 11,1 ms).

**Amit nem vonunk le.** A teljes fizikai lánc (kontroller rádió, kompozitor,
panel megjelenítés) hardverosztályonként állandó eltolást ad. Ezt nem korrigáljuk,
mert a becslése bizonytalanabb lenne, mint maga az eltolás. Helyette minden futás
tárolja az eszközosztályát, és az összehasonlítás csak azon belül történik.

---

## 7. METRIKÁK

### Nyers (próbánként)
`reactionTimeMs` · `outcome` (hit / false_alarm / timeout / invalid) · `correct` ·
`chosen` · `endpointErrorDeg` · `movementInitiationMs` · `rayPathDeg` ·
`asynchronyMs` · `source` · `hand` · `indexOfDifficulty` · `spreadDeg`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `simple_rt_median` | Medián RT a helyes egyszerű próbákon |
| `simple_rt_mad` | Medián abszolút eltérés × 1,4826 — kiugróálló szórásbecslés |
| `simple_rt_p10` / `p90` | 10. és 90. percentilis |
| `reciprocal_rt` | Az `1000/RT` értékek átlaga; a PVT szabványos, fáradtságérzékeny összegzése |
| `lapses` | 500 ms-nál lassabb válaszok száma |
| `false_starts` | Inger előtti válaszok száma |
| `omissions` | Válasz nélkül lejárt próbák |
| `choice_rt_median` | Medián választásos RT a helyes próbákon |
| `choice_accuracy` | Helyes / összes választásos próba |
| `decision_cost` | `choice_rt_median − simple_rt_median` |
| `speed_accuracy_tradeoff` | A lassú és a gyors fele pontosságkülönbsége |
| `point_accuracy` | Gyűrűn belüli megerősítések aránya |
| `endpoint_error_median` | Medián végponthiba fokban |
| `movement_initiation_median` | Medián mozdulatindítási idő |
| `movement_time_median` | Medián mozdulatidő |
| `fitts_slope` | RT regressziós meredeksége a nehézségi index ellen (ms/bit) |
| `path_efficiency` | Cél szögtávolsága / bejárt szögút (0–1) |
| `tracking_rms_error` | Négyzetes középhiba fokban |
| `time_on_target` | 3,2°-on belül töltött idő aránya |
| `tracking_lag` | Becsült követési késés (a hiba mediánja a hiba változási sebességéhez viszonyítva) |
| `tracking_speed_decay` | A célon töltött idő meredeksége a három, egyre gyorsabb próbán át |
| `bimanual_accuracy` | Helyes kétkezes próbák aránya |
| `bimanual_asynchrony` | Medián eltérés a két kéz között kétoldali ingernél |
| `hand_asymmetry` | Bal medián RT − jobb medián RT |

### Score-ok (0–100) és a horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `speed` | 240 ms | 520 ms | PVT-tartomány + VR-latencia korrekció |
| `choice` | 340 ms | 700 ms | választásos RT szakirodalmi tartomány |
| `stability` | MAD 18 ms | MAD 95 ms | PVT variabilitás |
| `lapse` | 0 lapszus | próbák 25%-a | PVT konvenció |
| `precision` | 0,6° hiba | 4,5° hiba | célméretből származtatva |
| `tracking` | 100% célon | 0% | közvetlen arány |
| `bimanual` | 0,6 × pontosság + 0,4 × (20 ms → 260 ms aszinkrónia) | | |

A normalizálás logisztikus vállal történik (`normaliseSoft`), hogy a szélsőértékek
ne torlódjanak 0-ra és 100-ra.

**A horgonyok provizórikusak.** A `scoring_version` minden score mellett tárolódik,
tehát a saját normaminta felvétele után minden korábbi futás újraszámolható.

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Sebesség (`speed` + `choice`) / 2 | 0,26 |
| Pontosság (választás + mutatás + kétkezes átlaga) | 0,24 |
| Stabilitás (`stability` + `lapse`) / 2 | 0,18 |
| Precizitás | 0,12 |
| Követés | 0,14 |
| Kétkezes | 0,06 |

**Ellenőrzött viselkedés.** Három szintetikus profil (gyors / átlagos / lassú)
918 / 721 / 329 pontot kap — a sorrend helyes és a szétválás nagy
(`tests/react-scoring.test.ts`).

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `run_start` | module, version, mode, platform, seed |
| `flow_state` | state, block |
| `block_start` / `block_end` | block, practice |
| `trial_prepare` | block, practice |
| `stimulus_onset` | block, inger paraméterei, `quantisationMs` |
| `response` | outcome, correct, rtMs, minden válaszmező |
| `false_start` | block, action |
| `track_start` | trial, speed, durationMs |
| `track_sample` | errDeg, onTarget — minden 6. frame |
| `track_end` | rmsErrorDeg, timeOnTarget, estimatedLagMs |
| `run_finish` | opsScore |

**Mozgásnaplózás: 30 Hz.** Fej és mindkét kontroller pozíciója + orientációja,
3 tizedesre kerekítve. Ez azért ilyen sűrű, mert a mutatási és követési blokkban
a kéz pályája valódi metrika, nem melléktermék; egy 7 perces futás így
kb. 12 600 minta, ami egy JSONB dokumentumban jól tárolható.

---

## 9. ADATBÁZIS

A `trials.stimulus` mezői blokkonként:

```jsonc
// simple
{ "kind": "simple", "practice": false }
// choice
{ "kind": "choice", "color": "red", "required": "left" }
// point
{ "kind": "point", "azimuthDeg": -18.4, "elevationDeg": 6.1, "widthDeg": 4.6,
  "amplitudeDeg": 31.2, "indexOfDifficulty": 3.76, "spreadDeg": 26, "platform": "desktop" }
// twohand
{ "kind": "twohand", "required": "both" }
```

A `trials.response`:

```jsonc
{ "rtMs": 412.3, "source": "right", "hand": "right",
  "endpointErrorDeg": 1.24, "movementInitiationMs": 218.4, "rayPathDeg": 44.9,
  "asynchronyMs": 63.1, "chosen": "both" }
```

Új tábla nem kell.

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — cím, alcím, összefoglaló, az öt blokk listája próbaszámokkal.
   Gombok: „VISSZA” és „MÉRÉS INDÍTÁSA”.
2. **INSTRUKCIÓ** (blokkonként) — a blokk címe, két-három mondat, kiemelt
   „IRÁNYÍTÁS” doboz a platformspecifikus szöveggel, és a próbaszámok.
3. **GYAKORLÁS** — visszajelzéssel: helyes válasznál a reakcióidő
   ezredmásodpercben, hibásnál „HIBÁS”, korainál „TÚL KORAI”, kimaradtnál
   „KIMARADT”.
4. **„MOST JÖN A MÉRÉS”** — „Innentől nincs visszajelzés és nincs segítség.
   Csak ez a rész számít bele az eredménybe.”
5. **MÉRÉS** — az információs panel eltűnik; csak a HUD marad (blokk-jelzők,
   aktuális blokk neve, KILÉPÉS).
6. **FELDOLGOZÁS** — rövid, ~260 ms, hogy a képernyőváltás ne legyen ugrásszerű.
7. **EREDMÉNY** — a pontszám nagyban, alatta hat sor:

| Sor | Példaérték |
|---|---|
| Egyszerű reakció (medián) | `284 ms` (szórás `31 ms`) |
| Választásos reakció | `396 ms` (`96% pontos`) |
| Döntési többletidő | `112 ms` |
| Lapszusok (>500 ms) | `1 / 24` |
| Célon töltött idő | `78%` |
| Kétkezes eltérés | `47 ms` |

Alul a mentés állapota és a terület figyelmeztetése.

---

### Mobil vezérlés

| Blokk | Mobil megoldás |
|---|---|
| 1 Egyszerű reakció | koppintás bárhol |
| 2 Választásos reakció | **BAL** és **JOBB** gomb |
| 3 Célra mutatás | koppintás a gyűrű közepére |
| 4 Folyamatos követés | ujjal követés |
| 5 Két kéz | **BAL** és **JOBB** gomb, egyszerre is nyomható |

A 2. és 5. blokk korábban a képernyő láthatatlan bal/jobb harmadára épült.
Ez felfedezhetetlen, és időnyomás alatt céltalan: a válasz helye nem látszott.
A gombok ugyanazt a `LEFT` / `RIGHT` eseményt adják, amit a ravaszok, tehát a
modul bemenetkezelése változatlan.

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az 1. blokk a Psychomotor Vigilance Test szerkezetét követi
(véletlen előidő, egyszerű detekció, lapszus-számlálás). A 3. blokk Fitts-féle
mutatási paradigmán alapul. A 4. blokk pursuit tracking. Eltérés: a PVT
tipikusan 10 perc, ez 24 próba — ez elég stabil mediánhoz, de **nem elég**
éberség-lejtés méréséhez; arra a WATCH való.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3, kontroller):
egyszerű RT medián 260–400 ms · MAD 20–60 ms · választásos RT 350–550 ms ·
döntési többlet 60–160 ms · végponthiba medián 0,8–2,5° · célon töltött idő 55–85%.
Asztali egérrel a reakcióidők jellemzően 30–60 ms-mal alacsonyabbak.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik fáradtság,
alkalmasság, betegség vagy figyelemzavar. Sportágajánlás önmagában ebből a
modulból nem adható.

**Tanulási hatás.** Az egyszerű reakció 2–3 felvétel után stabilizálódik
(kb. 15–25 ms javulás). A mutatási és követési blokk tovább javul, mert
eszközhasználati tanulás is van benne. Longitudinális összehasonlításnál ezért
az első felvételt érdemes bemelegítésnek tekinteni.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. Az inger előtti válasz `invalid` kimenetet ad, és a próba nem számít hit-nek.
2. Válasz nélkül a válaszablak lejártakor a próba `timeout` kimenettel zárul.
3. Az előidő minden próbában 1400 és 4200 ms közé esik, és eloszlása nem egyenletes.
4. Két azonos seedű futás azonos ingersorrendet és azonos szín-, pozíció- és
   méretsorozatot ad.
5. A gyakorló próbák nem kerülnek a pontozásba (`this.trials` csak mért próbákat tartalmaz).
6. Mérés közben nincs visszajelzés: a `feedback` fázis hossza 0 ms.
7. Asztali módban minden célgyűrű a viewporton belülre esik (|azimut| ≤ 26°).
8. Minden `stimulus_onset` esemény tartalmaz `quantisationMs` mezőt.
9. A mozgásnapló legalább 25 Hz-cel mintavételez VR-ben.
10. A modul kilépéskor minden általa létrehozott 3D objektumot és panelt felszabadít.
11. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t; hiányzó adat
    esetén gondolatjel jelenik meg.
12. Három szintetikus profil (gyors / átlagos / lassú) monoton csökkenő OPS
    pontszámot kap, legalább 200 pont különbséggel a szélsők között.
13. A blokk lefutása után az `abort()` hívás nem hagy futó időzítőt.
14. A `decision_cost` pozitív minden olyan futásnál, ahol mindkét blokk teljesült.

---

# B VÁLTOZAT — NYÚLÁS ÉS ELFOGÁS (`REACT_SPATIAL_B`)

Ez a fejezet a modul **B változatát** írja le. Az A változat (1–12. fejezet)
változatlan és minden platformon fut. A B változat **kizárólag VR-ben** érhető el,
és a modulkártyán lapos platformon letiltva jelenik meg, kiírt indoklással.

## B/1. Miért van B változat

Az A változat gombnyomásos válaszokat mér: egyszerű RT, választásos RT, Fitts-mutatás
sugárral. A laposítási teszten megbukik — a sugárral mutatás egy 2D vetületi feladat,
amit az egér pontosan ugyanúgy old meg. A mért mennyiség a *döntés* ideje, nem a
*mozgásé*.

A B változat a motoros teljesítményt méri ott, ahol az valóban létezik: a
**peripersonalis térben**, karnyújtásnyira, ahol a mozgás amplitúdójának mélységi
komponense is van. Ez az a mérés, amit egérrel nem lehet elvégezni, mert az egér
mozgása egy síkon történik.

## B/2. Térbeliség — a modul létjogosultsága

**Laposítási kérdés:** ha a célokat egy síkra vetítenénk, a `fitts_slope_3d`
elveszítené a mélységi amplitúdókomponenst, a `depth_reach_cost`, a
`tracking_depth_rms`, a `tracking_depth_dominance`, a `bimanual_depth_asynchrony`
és a teljes `intercept` blokk értelmezhetetlenné válna. A modul metrikáinak
többsége eltűnik. Térbeli.

Affordanciák:

| Affordancia | Metrika |
|---|---|
| **Peripersonal** — karnyújtásnyi tér | `fitts_slope_3d`, `fitts_throughput`, `reach_endpoint_error`, `reach_path_ratio` |
| **Approach / trajektória** | `interception_hit_rate`, `interception_timing_ce/ve`, `interception_spatial_error` |
| **Depth** — önálló csatorna | `depth_reach_cost`, `tracking_depth_rms`, `tracking_depth_dominance`, `bimanual_depth_asynchrony` |
| **Rotation / szilárd testek** | a célok forognak, tehát a sziluettjük változik, a fizikai méretük nem |

## B/3. Feladatstruktúra

| # | Blokk | Próba | Gyakorlás | Cél |
|---|---|---|---|---|
| 1 | `reach` — NYÚLÁS | 27 | 6 | 3D Fitts-rács, mozgásindítás és -kivitelezés szétválasztva |
| 2 | `intercept` — ELFOGÁS | 24 | 5 | mozgó cél elfogása repülés közben |
| 3 | `track3d` — TÉRBELI KÖVETÉS | 3 × 20 s | 1 | folyamatos követés mélységi komponenssel |
| 4 | `bimanual` — KÉT KÉZ, KÉT TÁVOLSÁG | 18 | 4 | egyidejű közeli és távoli nyúlás |

**1. blokk — a klasszikus Fitts-rács térben.** Három amplitúdó (0,42 / 0,62 / 0,82 m
sugár a kiinduló pozíciótól) × három célszélesség (0,055 / 0,085 / 0,12 m átmérő),
azimut ±42°, eleváció −24°…+26°. A nehézségi index a **teljes 3D távolságból**
számítódik: `ID = log2(2A / W)`. Minden próba előtt a kéznek vissza kell térnie a
`homeMarker` gyűrűbe (0,16 m torusz), így az amplitúdó ténylegesen kontrollált, nem
az előző cél helyétől függ.

A `reach_initiation` a cél megjelenése és a kéz elmozdulásának kezdete közti idő,
a mozgásidő ettől külön mérve. Ez a szétválasztás a lényeg: a Fitts-meredekség
csak a **mozgásidőre** érvényes; ha a döntési időt is beleszámolnánk, a meredekség
kognitív komponenssel szennyeződne.

**2. blokk.** Gömbök (0,13 m) repülnek a résztvevő felé 1,1–1,9 s repülési idővel,
oldalirányú eltéréssel. Az elfogás akkor sikeres, ha a kontroller hegye a
találkozási ablakban a gömb 0,12 m-es környezetében van. Külön mérjük a **térbeli**
hibát (hol volt a kéz) és az **időzítési** hibát (mikor volt ott) — a kettő
disszociálható, és eltérő edzhetőségű.

**3. blokk.** A követett gömb pályája három szinuszkomponens összege, amelyek közül
az egyik **sugárirányú**. A követési hibát ezért két merőleges komponensre bontjuk:
`tracking_lateral_rms` (a nézőirányra merőleges) és `tracking_depth_rms` (a
nézőirány mentén). A `tracking_depth_dominance` = mélységi RMS / (mélységi + oldalsó
RMS): 0,5 körüli érték kiegyensúlyozott követést jelent, 0,7 fölött a résztvevő
a mélységi komponenst rosszul kezeli — ez az a hiba, ami lapos kijelzőn
definíció szerint nem létezik.

**4. blokk.** Két cél egyszerre, eltérő távolságban (0,42 és 0,82 m), balra és jobbra.
Mindkét kézzel egyszerre kell megérinteni. A `bimanual_depth_asynchrony` a két érintés
közti abszolút időkülönbség: a bimanuális koordináció klasszikusan romlik, ha a két
kéz eltérő nehézségi indexű mozgást végez (Kelso-féle interferencia), és a
**távolságkülönbség** ennek térbeli megvalósítása.

## B/4. Ingerdefiníció

| Elem | Primitív | Méret | Szín |
|---|---|---|---|
| Nyúlási cél | gömb | 0,055 / 0,085 / 0,12 m átmérő | `accent` |
| Kiinduló jelölő | tórusz | 0,16 m | `textMuted`, 0,35 opacitás |
| Repülő cél | gömb | 0,13 m | `accent` |
| Követett cél | gömb | 0,11 m | `accent` |
| Visszajelző panel | sík | 0,70 × 0,16 m | — |

A célok lassan forognak (`tumbler`, 0,2–0,5 rad/s). Ennek nem díszítő szerepe van:
a forgás mozgásparallaxist ad a testnek, ami a távolságbecslés egyik támpontja.
Külső 3D asset nincs.

## B/5. Keresztplatform leképezés

A B változat `supports: ['vr']`. Ez nem korlátozás, hanem a mérés definíciója:

| Elem | VR | Miért nincs lapos megfelelője |
|---|---|---|
| Fizikai nyúlás | kontrollerhegy pozíciója | az egérnek nincs mélységi koordinátája |
| Elfogás | ütközés a repülő testtel | a kattintás pillanatszerű, nincs pályája |
| Kétkezes feladat | két kontroller | egy egér van |

A modulkártya B gombja lapos platformon **letiltva** jelenik meg, a magyarázat
a gombon: „VR-t igényel”. A rendszer nem indít el helyette csendben egy
degradált verziót — ez a `03-SPATIAL-DESIGN.md` őszinteségi szabálya.

## B/6. Metrikák

| Metrika | Definíció | Egység |
|---|---|---|
| `fitts_slope_3d` | a mozgásidő regressziós meredeksége a 3D nehézségi indexre | ms/bit |
| `fitts_intercept_3d` | ugyanezen regresszió tengelymetszete | ms |
| `fitts_throughput` | átlagos `ID / MT` | bit/s |
| `reach_endpoint_error` | a végpont és a célközéppont átlagos távolsága | m |
| `reach_path_ratio` | megtett úthossz / egyenes távolság | arány |
| `reach_initiation` | cél megjelenése → a kéz elindulása | ms |
| `depth_reach_cost` | a mozgásidő meredeksége az amplitúdó mélységi komponensére | ms/m |
| `interception_timing_ce` / `_ve` | előjeles / szórásjellegű időzítési hiba | ms |
| `interception_spatial_error` | a kéz és a gömb távolsága a legközelebbi pillanatban | m |
| `tracking_depth_dominance` | mélységi RMS / (mélységi + oldalsó RMS) | arány |
| `bimanual_depth_asynchrony` | a két érintés közti időkülönbség | ms |
| `fitts_slope_first_half` / `_second_half` | a Fitts-meredekség a blokk első és második felében | ms/bit |
| `reach_fatigue_drift` | `fitts_slope_second_half − fitts_slope_first_half` | ms/bit |

**OPS SCORE:**

| Összetevő | Súly |
|---|---|
| `reach_pointing` | 0,24 |
| `interception` (találat + időzítés átlaga) | 0,24 |
| `tracking_3d` | 0,20 |
| `reach_precision` | 0,16 |
| `bimanual_depth` | 0,16 |

## B/7. Validáció és korlátok

**Származás.** Fitts (1954) mutatási törvénye, a Shannon-formulával
(MacKenzie, 1992); a 3D kiterjesztés az ISO 9241-9 térbeli mutatóeszközökre
vonatkozó adaptációinak logikáját követi. Az elfogás a mozgáskoordinációs
kutatás interceptív feladata. A kétkezes blokk a bimanuális interferencia
paradigmája.

**Eltérés.** A Fitts-feladat klasszikusan síkban, oda-vissza mozgással történik;
itt diszkrét, hazatéréssel elválasztott nyúlások vannak, hogy az amplitúdó
kontrollált maradjon. A `throughput` értékek ezért nem hasonlíthatók közvetlenül
2D egérrel mért irodalmi értékekhez — csak VR-en belül, `vr:quest3:controller`
összehasonlíthatósági osztályon belül.

**Elvárt nagyságrend:** `fitts_slope_3d` 140–260 ms/bit, `fitts_throughput`
3,0–5,5 bit/s, `reach_endpoint_error` 0,02–0,05 m, `tracking_depth_dominance`
0,45–0,65.

**Amit nem mér:** valódi manuális ügyességet szerszámmal, tapintást,
erőkifejtést. A kontroller súlya és a haptikus visszajelzés hiánya miatt az
eredmény nem vihető át közvetlenül fizikai munkakörre.

**Fizikai korlát.** A blokk karnyújtásnyi mozgásokat kér 27 + 24 + 18 alkalommal.
A modul a `reach` blokk közepén szünetet ajánl, és a fáradás miatt a
`fitts_slope_3d` a blokk első és második felére külön is naplózódik.

## B/8. Elfogadási kritériumok

1. A `homeMarker` elhagyása nélkül egyetlen `reach` próba sem indul el.
2. A 3D nehézségi index a tényleges térbeli amplitúdóból számítódik, nem a vetületiből.
3. A mozgásindítás és a mozgásidő külön mezőben kerül az adatbázisba.
4. A B változat lapos platformon nem indítható el; a kártyagomb letiltott és indokolt.
5. Minden `intercept` próbában a gömb elhalad a résztvevő 0,3 m-es környezetében.
6. A követési hiba mélységi és oldalirányú komponensre bontva kerül naplózásra.
7. A `bimanual` blokkban a két cél sugárkülönbsége mindig 0,40 m.
8. Azonos seed azonos Fitts-rácsot és sorrendet ad.
9. Egy teljes B futás 8–11 perc.
10. A célok forgása nem változtatja meg a fizikai átmérőt (skálázás csak a `width`-ből).
