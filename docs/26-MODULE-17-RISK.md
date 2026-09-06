# 26 — MODUL 17 · RISK · Kockázatvállalás & döntési stílus

**Kód:** `RISK` · **Sorszám:** 17 · **Verzió:** 0.1.0
**Konfiguráció:** `RISK_STANDARD_A` (alap), `RISK_SHORT` (rövid)
**Platform:** VR · asztali · mobil — **eltérő blokkszámmal** (lásd 5.)
**Paradigmák:** Balloon Analogue Risk Task (Lejuez et al., 2002),
Iowa Gambling Task (Bechara et al., 1994), post-error/post-loss slowing
**Kapcsolódó dokumentumok:** `00-MASTER-SPEC.md` 5/17 és 12., `03-SPATIAL-DESIGN.md`

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban.** A RISK azt írja le, **hogyan viselkedik a felhasználó
ismételt nyereség-veszteség helyzetekben**: meddig megy el, mennyit tanul a
visszajelzésből, és mit csinál egy veszteség után.

**Ez nem személyiségteszt, és nem is rangsor.** A modul megfigyelt
viselkedést ír le egy konkrét feladatban. A túl konzervatív és a túl vakmerő
döntéshozó **egyaránt** eltérés az optimumtól, és a pontozás ezt szimmetrikusan
kezeli — a `risk_calibration` összetevő attól függ, milyen messze esik a
viselkedés a feladat tényleges valószínűségei szerinti optimumtól, **nem** attól,
hogy alacsony vagy magas.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Honnan | Katalógus |
|---|---|---|---|
| Kockázatvállalási viselkedés | A megfigyelt megállási pont ismételt, növekvő tétű helyzetben | BART | 65 |
| Kockázatértékelés | Mennyire igazodik a viselkedés a feladat tényleges valószínűségeihez | BART EV-optimum | 44 |
| Döntés bizonytalanságban | Választás rejtett, csak tapasztalatból megismerhető eloszlások között | IGT | 52 |
| Visszajelzés alapú tanulás | A jó és rossz opciók elkülönítésének időbeli meredeksége | IGT blokkonkénti nettó pontszám | — |
| Veszteségkövetés | A veszteség utáni kockázatnövelés mértéke | BART robbanás utáni viselkedés | — |

### Amit a modul kifejezetten NEM mér

- **Nem személyiségjegy.** Nincs „kockázatkerülő típus”. Az eredmény mondata
  kötelezően: *„megfigyelt kockázatvállalás ebben a feladatban”*.
- **Nem jósol munkahelyi vagy közlekedési szabályszegést.** A BART és az IGT
  laboratóriumi analógiák; a transzfer külön validálást kíván.
- **Nem klinikai eszköz.** Az IGT-t neuropszichológiai kontextusban is
  használják; ez a modul nem diagnosztizál semmit.
- **Nem méri az intelligenciát vagy a matematikai képességet.** A
  valószínűségeket nem közöljük, tehát nincs mit kiszámolni — csak tapasztalni.
- **Nem méri a valódi pénzügyi kockázatvállalást.** A tét pont, nem pénz, és
  ezt a résztvevő is tudja. A hipotetikus és a valós tét közti különbség a
  szakirodalom ismert korlátja.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**B — munka (`primary`).** A munkabiztonsági szabályszegés és a pénzügyi
kockázatvállalás közös nevezője nem a bátorság, hanem a **visszajelzésből
való tanulás mintázata**: kit tanít meg egy majdnem-baleset, és kit nem.
Az IGT-blokk pontosan ezt méri.
*Munkakörök:* munkavédelmi kockázatszűrés, kereskedő, projektvezető,
gépkezelő, beszerző.

**C — sport (`primary`).** Támad vagy biztosít? A taktikai kockázatvállalás
sportágcsoportot és szerepkört is elkülönít, és az extrémsportokban a
kockázati profil a felkészülés része.
*Sportágak:* kerékpáros szökés, sziklamászás, síugrás, póker/e-sport, motorsport.

**A — védelmi (`secondary`).** Itt a **szélsőségek** érdekesek, nem a
középérték: a túl konzervatív és a túl vakmerő döntéshozó egyaránt kockázat.
Ezért kiegészítő mutató, soha nem önálló kiválasztási szempont.
*Munkakörök:* parancsnoki kiválasztás, tűzszerész, pilóta.

---

## 3. FELADATSTRUKTÚRA

### 3.1. Blokkok

| # | Blokk | Cél | Próbaszám | Gyakorlás | Platform |
|---|---|---|---|---|---|
| 1 | `bart_size` | BART: a tét **nő** (szögméret) rögzített távolságon | 12 léggömb | 2 | mind |
| 2 | `bart_approach` | BART: a tét **közeledik**, állandó szögméret mellett | 12 léggömb | 2 | **csak VR** |
| 3 | `cards` | IGT: négy pakli rejtett eloszlással | 60 kártya | 6 | mind |

**Idő:** VR-ben kb. 7 perc, sík platformon kb. 5 (a második blokk kimarad).
Ez a `duration` mezőben a VR-értékkel szerepel, és a kezdőtér a platformnak
megfelelő becslést mutatja.

### 3.2. BART — a trial anatómiája

```
PREPARE          új léggömb, a tét nullázva; a PUMPA és a BEVÁLTÁS cél megjelenik
COUNTDOWN        nincs
STIMULUS         a léggömb aktuális állapota (ez maga a folyamatos inger)
RESPONSE WINDOW  korlátlan; a döntés a felhasználóé
RESPONSE         PUMPA (a tét +5, és a robbanás kockázata nő)
                 vagy BEVÁLTÁS (a tét a bankba kerül, a léggömb eltűnik)
FEEDBACK         pumpánál: a léggömb nő; robbanásnál: hang + a tét elveszik;
                 beváltásnál: hang + a bank nő. **A robbanási pontot soha nem
                 mutatjuk meg** — ez tenné a feladatot tanulhatóvá.
INTER-TRIAL      1200 ms
```

**A robbanás valószínűsége.** A léggömb legfeljebb 16 pumpát bír. Az `n`-edik
pumpánál a robbanás valószínűsége `1 / (17 − n)`, ami **egyenletes eloszlású
robbanási pontot** ad 1 és 16 között — a BART eredeti konstrukciója, csak
rövidebb skálán. A várható értéket maximalizáló megállás **8 pumpánál** van;
ez az érték a `risk_calibration` referenciapontja, és a modul **soha nem
közli** a felhasználóval.

Pumpánként 5 pont; a beváltott pontok a bankba mennek, a robbanás a
teljes aktuális tétet elviszi.

### 3.3. Cards (IGT) — a trial anatómiája

```
PREPARE          a négy pakli elérhető
STIMULUS         a paklik megjelölése; a bank látszik
RESPONSE WINDOW  korlátlan
RESPONSE         egy pakli választása
FEEDBACK         900 ms: a nyereség, és ha van, a veszteség
INTER-TRIAL      500 ms
```

**A négy pakli** (Bechara-szerkezet, 10 kártyás ciklusokban):

| Pakli | Nyereség / kártya | Veszteség | Nettó / 10 kártya |
|---|---|---|---|
| **A** | +100 | 5-ből: −150, −200, −250, −300, −350 | **−250** |
| **B** | +100 | 1-ből: −1250 | **−250** |
| **C** | +50 | 5-ből: −25, −50, −50, −50, −75 | **+250** |
| **D** | +50 | 1-ből: −250 | **+250** |

A és B **rossz** paklik (nagy azonnali nyereség, nagyobb veszteség), C és D
**jók**. A és C gyakori kis veszteségeket ad, B és D ritka nagyot — ez a
kettős szerkezet választja el a *nyereség* nagyságára és a *veszteség
gyakoriságára* való érzékenységet.

A veszteségek sorrendje paklin belül a futás seedjéből kevert, de a
10-kártyás ciklus nettó egyenlege **fix**. A pakliknak a felületen elfoglalt
helye szintén futásonként kevert, hogy a „balról a második” szokás ne vigyen
információt egy ismételt mérésbe.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szín |
|---|---|---|---|
| Léggömb | `sphere` | ø 0,06 → 0,26 m (16 pumpa alatt) | `accent2`, telítettség a téttel nő |
| PUMPA cél | `cylinder` | ø 0,10 × 0,03 m | `accent` |
| BEVÁLTÁS cél | `box` | 0,12 × 0,08 × 0,03 m | `ok` |
| Pakli | `box` | 0,11 × 0,015 × 0,15 m | paklinként eltérő `hue` |
| Bankkijelző | canvas panel | 0,52 × 0,16 m | `surface` |

**Elhelyezés.** Minden interaktív elem a `BodyAnchor`-hoz képest, karnyújtáson
belül: a PUMPA cél `offset(−0,16, −0,26, 0,42)`, a BEVÁLTÁS cél
`offset(+0,16, −0,26, 0,42)` — 0,32 m-re egymástól, tehát a kettő közti
mozdulat valódi, mérhető kar-mozdulat. A léggömb középen,
`offset(0, −0,02, 0,70)`.

A négy pakli egy 0,44 m sugarú íven, `−33°`, `−11°`, `+11°`, `+33°` azimuton,
mind elérhető távolságban.

### 4.1. A két BART-változat közti egyetlen különbség

| | `bart_size` | `bart_approach` |
|---|---|---|
| Távolság | rögzített 0,70 m | 1,60 m → 0,42 m |
| Fizikai átmérő | 0,06 → 0,26 m | **állandó**, a szögméret tartásához skálázva |
| Szögméret | 4,9° → 20,9° | **állandó 12,0°** |
| Amit a növekedés hordoz | szögméret | **kizárólag diszparitás és parallaxis** |

A második változat a `03-SPATIAL-DESIGN.md` 2.2. pontjának megvalósítása:
a szögméretet állandóan tartva a közeledést **csak** a binokuláris diszparitás
és a mozgásparallaxis hordozza. Ez sík képernyőn nem létezik, tehát a blokk
ott nem is fut.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

### 5.1. Besorolás

| Feladatelem | Osztály | Indoklás |
|---|---|---|
| Pumpálás / beváltás döntés | `equivalent` | a döntés maga nem térbeli — ezt a modul kimondja |
| Pakliválasztás | `equivalent` | ugyanaz |
| Cél megközelítése kézzel | `adapted` | VR: nyúlás · asztali: egérpálya · mobil: **nincs** |
| Közeledő tét (`bart_approach`) | `vr-only` | állandó szögméret mellett a mélységet csak a diszparitás hordozza |

### 5.2. A térbeliség őszinte mérlege

A `03-SPATIAL-DESIGN.md` 1. fejezetének kérdésére — *mi változna, ha
lelapítanám?* — a válasz erre a modulra részben **semmi**: a BART és az IGT
döntési feladatok, és a `adjusted_risk_index`, a `learning_slope`, a
`loss_chasing_index` és a `decision_consistency` mind változatlan maradna
egy monitoron.

**Ezt nem takarjuk el, és nem is kényszerítünk bele térbeliséget.**
A modul két dolgot ad hozzá, és mindkettőnek megvan a helye:

1. **`approach_risk_shift` (VR-only, pontozott).** A két BART-blokk
   megállási pontjának különbsége. Ha valaki hamarabb áll meg, amikor a tét
   fizikailag közeledik — miközben a **valószínűségek azonosak** —, akkor a
   kockázatértékelése a látvány fenyegetőségére reagál, nem a tényleges
   költségre. Ez valódi, megnevezhető képességkülönbség
   (*a kockázatértékelés jelzésfüggetlensége*), és bekerül a pontozásba.
2. **`reach_hesitation_ms` és `reach_reversal_rate` (leíró, nem pontozott).**
   A két cél közti kézmozdulat közben megfigyelhető a döntési konfliktus.
   Asztalon ugyanez az egérpályán látszik, de **más mennyiség**, ezért más a
   neve (`pointer_hesitation_ms`, `pointer_reversal_rate`), és a kettő
   soha nem kerül egy normacsoportba. Mobilon **egyáltalán nincs**: az
   érintésnél nincs hover, tehát nincs mozdulat a válasz előtt
   (`02-CROSSPLATFORM-INTERACTION.md` 3.1).

Ezért a RISK **nem** felel meg a „legalább két térbeli eszköz a pontozásban”
átvételi feltételnek, és ezt a modul dokumentációja kimondja. Egy döntési
paradigmába erőltetett második térbeli mutató azt jelentené, hogy az OPS
részben azt méri, mennyire ingadozik valaki mélységben — ami nem kompetencia.

### 5.3. Platformonként kieső metrikák

| Metrika | vr | desktop | mobile |
|---|---|---|---|
| `approach_risk_shift` | ✓ | — | — |
| `reach_hesitation_ms` / `reach_reversal_rate` | ✓ | — | — |
| `pointer_hesitation_ms` / `pointer_reversal_rate` | — | ✓ | — |
| minden egyéb | ✓ | ✓ | ✓ |

Sík platformon az OPS-súlyok átskálázódnak, és a futás
`spatialWeightsApplied: false` értékkel rögzül.

### 5.4. `controlHint`

| Platform | Szöveg |
|---|---|
| VR | `RAVASZ a célon: pumpa vagy beváltás` |
| asztali | `KATTINTÁS a célon · SZÓKÖZ: pumpa · ENTER: beváltás` |
| mobil | `PUMPA / BEVÁLTÁS gomb · a pakliknál A B C D` |

---

## 5/B. MOBIL VEZÉRLŐKÉSZLET

| Blokk | `buttons` | `dial` | `slider` | `look` | `hint` |
|---|---|---|---|---|---|
| `bart_size` | `PUMPA` (primary) · `BEVÁLTÁS` (accent2) | — | — | `off` | „Meddig mész el? A beváltott pont a tiéd.” |
| `cards` | `A` `B` `C` `D` (ghost) | — | — | `off` | „Válassz paklit. Van, amelyik többet hoz, mint amennyit visz.” |

**Három állítás.**

1. **Két gomb, nem egy.** A modul azt méri, mikor **áll meg** valaki. Ha a
   beváltás nem lenne ugyanolyan elérhető, mint a pumpálás, a megállási
   pontot a felület kényelmetlensége is befolyásolná, nem csak a döntés.
   A `BEVÁLTÁS` ezért ugyanakkora és ugyanolyan könnyen elérhető.
2. **Négy gomb, nem `dial`.** A `dial` iránykérdésre való; a paklinak nincs
   iránya, csak neve. A négy gomb `onTap` visszahívással dolgozik, nem
   akcióleképezéssel, mert négy egyenrangú választásra nincs négy
   természetes absztrakt akció.
3. **`look: 'off'`.** A modul minden döntés reakcióidejét naplózza, a
   húzásos körbenézés pedig a `pointerup`-ig halasztaná a választ
   (`02-CROSSPLATFORM-INTERACTION.md` 3.5). Mobilon nincs is mit
   körbenézni: az egyetlen körülvevő elem a `bart_approach`, ami ott nem fut.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Mi teszi nehezebbé.** A maximális pumpaszám (és így a robbanás
valószínűségi profilja), a paklik nettó egyenlege és a veszteségek
gyakorisága, valamint a próbaszám (kevesebb kártyából nehezebb megtanulni).

### `RISK_STANDARD_A`

```
balloons                 12   (blokkonként)
maxPumps                 16
pumpValue                5
evOptimalPumps           8
cardTrials               60
cardBlockSize            20
deckNet10                A −250 · B −250 · C +250 · D +250
feedbackMs               900
interTrialMs             500 / 1200 (kártya / léggömb)
targetSeparationM        0.32
balloonDistanceM         0.70            (bart_size)
approachRangeM           1.60 → 0.42     (bart_approach)
approachAngularSizeDeg   12.0
```

### `RISK_SHORT`

```
balloons                 8
cardTrials               40
minden egyéb             azonos
```

### CHALLENGE mód

**Nincs.** A `challengeMode` a manifesztben `false`, és ez szándékos:
egy élő pontszám és egy ranglista pontosan azt a versenyhelyzetet
teremtené, ami a kockázatvállalást a feladat valószínűségeitől
elszakítja. A modul mérési értéke azon áll, hogy a tét **belső**.

---

## 7. METRIKÁK

### 7.1. Nyers

| Név | Egység |
|---|---|
| `pumps` | darab, léggömbönként |
| `exploded` | 0/1 |
| `earned` | pont, léggömbönként |
| `pump_rt_ms`, `cash_rt_ms` | ms |
| `deck` | A/B/C/D |
| `card_gain`, `card_loss` | pont |
| `card_rt_ms` | ms |
| `reach_path_mm`, `reach_reversals` | mm, darab (VR és asztali) |

### 7.2. Származtatott

**`adjusted_risk_index`** = az átlagos pumpaszám **azokon a léggömbökön,
amelyek nem robbantak fel.** Ez a BART standard mutatója, és azért ez, mert a
felrobbant léggömbökön a pumpaszámot a robbanás vágja el — az ottani átlag
részben a véletlené, nem a döntésé.

**`risk_calibration_error`** = `|adjusted_risk_index − 8|`, ahol 8 a várható
értéket maximalizáló megállás. **Előjel nélküli**: a túl korai és a túl késői
megállás egyaránt kalibrációs hiba.

**`loss_chasing_index`** = a robbanás **utáni** léggömb pumpaszámának átlaga
mínusz a sikeres beváltás utáni léggömbök átlaga. Pozitív = veszteségkövetés
(a veszteség után nagyobbat kockáztat), negatív = visszahúzódás.

**`post_loss_slowing_ms`** = az első döntés reakcióidejének mediánja
veszteség után, mínusz ugyanez nyereség után.

**`learning_slope`** = az IGT nettó pontszám `(C+D) − (A+B)` blokkonként
(3 × 20 kártya), és ezek lineáris meredeksége a blokkindex szerint.
Pozitív = tanul; nulla körüli = nem különíti el a paklikat.

**`net_score_final`** = a nettó pontszám az utolsó 20 kártyán.

**`decision_consistency`** = `1 − (pakliváltások száma / 19)` az utolsó
20 kártyán. 1 = végig ugyanazt választotta, 0 = minden kártyánál váltott.

**`deck_frequency_sensitivity`** = `(A + C) − (B + D)` választásszám. A
ritka nagy veszteséget (B, D) kerülő és a gyakori kicsit kerülő
viselkedés elkülönítése; leíró, nem pontozott.

**`approach_risk_shift`** (VR) = `adjusted_risk_index(bart_approach) −
adjusted_risk_index(bart_size)`. **A két blokk valószínűségi profilja
azonos**, tehát bármilyen eltérés a megjelenítésre adott válasz.

**`reach_hesitation_ms`** = a mozdulat megindulásától a válaszig eltelt idő
mediánja, mínusz a legrövidebb ilyen idő az adott blokkban (a mozdulat puszta
végrehajtási ideje így kiesik).
**`reach_reversal_rate`** = azon döntések aránya, ahol a kéz először a másik
cél felé indult, majd irányt váltott.

### 7.3. Score (0–100) és horgonyok

| Score | Metrika | `good` | `poor` | Indoklás |
|---|---|---|---|---|
| `risk_calibration` | `risk_calibration_error` | 1,5 pumpa | 6,0 pumpa | 8 az EV-optimum; ±1,5 gyakorlatilag optimális, ±6 a skála szélein jár — **szimmetrikus** |
| `feedback_learning` | `learning_slope` | +9 / blokk | 0 | egy tanuló résztvevő a 3. blokkra +12…+18 nettót ér el a −5 körüli kezdetről |
| `decision_consistency` | `decision_consistency` | 0,80 | 0,30 | 0,30 alatt a választás gyakorlatilag véletlen |
| `loss_control` | `abs(loss_chasing_index)` | 0,8 pumpa | 4,0 pumpa | a veszteség utáni ±0,8 pumpányi eltérés zaj; 4 fölött rendszeres |
| `cue_independence` | `abs(approach_risk_shift)` | 0,6 pumpa | 3,5 pumpa | azonos valószínűségek mellett bármely eltérés a látványnak szól — **VR-only** |

Minden horgony **provizórikus**. A BART és az IGT szakirodalmi normái más
skálán (128 pumpa, 100 kártya) készültek, tehát nem emelhetők át.

### 7.4. OPS SCORE összetevők

| Összetevő | Súly (VR) | Súly (sík) |
|---|---|---|
| `risk_calibration` | 0,26 | 0,30 |
| `feedback_learning` | 0,26 | 0,30 |
| `loss_control` | 0,19 | 0,21 |
| `decision_consistency` | 0,17 | 0,19 |
| `cue_independence` | 0,12 | — |
| **Összeg** | **1,00** | **1,00** |

**A pontszám nem a kockázatvállalás szintjét jutalmazza**, hanem azt,
mennyire igazodik a viselkedés a feladat tényleges valószínűségeihez, és
mennyit tanul belőlük. Egy nagyon óvatos és egy nagyon merész résztvevő
ugyanazt a `risk_calibration` értéket kaphatja, ha ugyanannyira távol
van az optimumtól — ez szándékos.

**Tengelypontszámok:** `executive` = a learning és a consistency átlaga;
`attention` nincs (a modul nem méri).

---

## 8. ESEMÉNYNAPLÓ

| Eseménytípus | Payload |
|---|---|
| `risk_setup` | `platform`, `blocks[]`, `maxPumps`, `pumpValue`, `evOptimalPumps`, `deckOrder`, `deckSchedules`, `seed`, `quantisationMs` |
| `balloon_start` | `blockId`, `index`, `explodeAt` — **naplózva, de soha nem megjelenítve** |
| `pump` | `blockId`, `index`, `pumpNumber`, `rtMs`, `stake`, `angularSizeDeg`, `distanceM`, `reachPathMm`, `reachReversals` |
| `cash_out` | `blockId`, `index`, `pumps`, `earned`, `rtMs` |
| `explode` | `blockId`, `index`, `pumps`, `lost` |
| `card_choice` | `trial`, `deck`, `slot`, `gain`, `loss`, `net`, `bank`, `rtMs`, `switched` |
| `block_summary` | `blockId`, `adjustedPumps`, `explosions`, `earned`, blokk nettó pontszám |
| `reach_sample` | 30 Hz, csak a döntés előtti mozdulat alatt: `t`, `p[3]`, `target` |

**Mozgásnaplózás: 30 Hz.** A kéz pályája a `reach_hesitation_ms` és a
`reach_reversal_rate` forrása, tehát valódi metrika; 10 Hz-en egy 300 ms-os
irányváltás két mintába esne, ami nem elég a felismeréséhez.

**A robbanási pontot naplózzuk, de soha nem mutatjuk meg** — sem a
visszajelzésben, sem az eredményképernyőn. Aki megtudja, hogy „ez 11-nél
robbant volna”, a következő léggömbnél már nem ugyanazt a feladatot kapja.

---

## 9. ADATBÁZIS

Nincs új tábla.

**`trials`** — egy léggömb vagy egy kártya egy sor:

```json
stimulus: { "blockId": "bart_approach", "index": 7, "explodeAt": 11,
            "maxPumps": 16, "distanceM": 0.86, "angularSizeDeg": 12.0 }
response:  { "pumps": 9, "cashedOut": true, "earned": 45,
             "rtMsFirst": 820, "reachPathMm": 412, "reachReversals": 1 }
correct: null, outcome: "hit", reactionTimeMs: 820
```

A `correct` mező **`null`**, és ez fontos: ebben a modulban nincs helyes
válasz. Egy `true` érték azt sugallná, hogy a rendszernek van elvárása
arról, meddig kell elmenni — nincs.

---

## 10. FELHASZNÁLÓI FOLYAMAT

**INTRO.**
> **RISK — Döntés bizonytalanságban**
> Nincs jó és rossz válasz. Az a kérdés, hogyan döntesz, amikor nem tudod
> előre, mi fog történni — és mit kezdesz azzal, ami történt.
> **5–7 perc**

**INSTRUKCIÓ.**
> **LÉGGÖMB.** Minden pumpa 5 pontot ér, de a léggömb ki is durranhat —
> és akkor az addigi pontok elvesznek. Bármikor beválthatod, amit
> összegyűjtöttél. Nem mondjuk meg, mikor durran ki. Nincs „helyes”
> megállási pont.
>
> **PAKLIK.** Négy pakli. Mindegyik ad pontot, és néha elvesz. Az
> eloszlásuk különbözik, de nem áruljuk el, hogyan — ki lehet tapasztalni.

**KALIBRÁCIÓ.** Nincs külön kalibrációs lépés a testhelyzet rögzítésén túl.
A gyakorlóblokk két léggömbje ellenőrzi, hogy a felhasználó érti-e mind a
pumpálást, mind a beváltást — ha a gyakorlásban egyszer sem váltott be,
a modul megismételteti a gyakorlást, egyetlen mondattal:
> *Próbáld ki a beváltást is, hogy tudd, hogyan működik.*

**MÉRÉS.** `bart_size` → (VR: `bart_approach`) → `cards`.

**EREDMÉNY** (kiemelt sorok):

| Sor | Példaérték | Magyarázó |
|---|---|---|
| Megfigyelt megállási pont | **6,4 pumpa** | a fel nem robbant léggömbök átlaga |
| Illeszkedés a valószínűségekhez | **1,6 pumpával óvatosabb** | a feladat szerinti optimum 8 |
| Tanulás a visszajelzésből | **+11 / blokk** | a paklikat a mérés végére elkülönítetted |
| Veszteség után | **+0,4 pumpa** | a robbanás után nagyjából ugyanúgy döntöttél |
| Döntési állandóság | **0,75** | az utolsó húsz kártyán |
| Közeledő tét hatása | **−1,1 pumpa** | ugyanaz a valószínűség, közelebbről — *csak VR* |

**Az eredményképernyő állandó lábjegyzete:**
> *Ez megfigyelt viselkedés ebben a feladatban, nem jellemvonás. A túl
> óvatos és a túl merész döntés egyaránt eltérés a feladat tényleges
> valószínűségeitől; a pontszám ezt a távolságot méri, nem az irányát.*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Forrásparadigmák.** BART (Lejuez et al., 2002) és Iowa Gambling Task
(Bechara et al., 1994). A pakliszerkezet (A/B rossz, C/D jó; A/C gyakori kis
veszteség, B/D ritka nagy) és a 10 kártyás ciklusok nettó egyenlege az
eredetiből származik.

**Amiben eltérünk, és miért.**

1. **16 pumpa 128 helyett.** A 128-as skálán egy léggömb átlagosan 64
   pumpát kíván; egy 12 léggömbös blokk így 768 kattintás lenne. A rövidebb
   skála megőrzi az egyenletes robbanási eloszlást és az EV-optimum
   szerkezetét, de az abszolút értékek **nem** vethetők össze a
   szakirodalmi BART-értékekkel.
2. **60 kártya 100 helyett.** A tanulási görbe meredeksége 60 kártyán is
   megbecsülhető, de a becslés szórása nagyobb. A `learning_slope` ezért
   három 20-as blokkból számol, nem ötből.
3. **A tét pont, nem pénz.** Ismert korlát; a hipotetikus tét tompítja a
   kockázatvállalást. Mindkét BART-blokkban ugyanaz a tét, tehát a
   `approach_risk_shift` ettől független.
4. **Nincs CHALLENGE mód.** Lásd 6.

**Elvárt nagyságrendek (becslés, kalibrálandó):**

| Metrika | Tartomány |
|---|---|
| `adjusted_risk_index` | 4–11 pumpa (optimum 8) |
| `learning_slope` | −2 … +18 nettó / blokk |
| `loss_chasing_index` | −2 … +3 pumpa |
| `decision_consistency` | 0,35–0,90 |
| `approach_risk_shift` | −2,5 … +1,5 pumpa |

**Amit ebből NEM szabad kikövetkeztetni.** Alkalmasságot, jellemvonást,
klinikai állapotot, szabályszegési hajlamot, vagy azt, hogy valaki a
munkájában is így döntene. A modul egy konkrét feladat viselkedését írja le.

**Tanulási hatás.** A BART ismételt felvételnél stabil (a robbanási pont
véletlen marad), az IGT viszont **erősen** tanulható: aki egyszer megértette
a pakliszerkezetet, másodszorra a 2. blokktól optimálisan választ, és a
`learning_slope` értelmét veszti. Ismételt mérésnél ezért a pakliknak
**új helye és új veszteségsorrendje** van, de a szerkezet felismerése
így is átvihető — a `learning_slope` másodszori felvételtől
**nem értelmezhető**, és az eredményképernyő ezt kiírja.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

| # | Állítás | Hogyan tesztelhető |
|---|---|---|
| 1 | 10 000 szimulált léggömbnél a robbanási pont eloszlása egyenletes 1 és 16 között (χ² alapján). | A generátor közvetlen mintavételezése. |
| 2 | A várható értéket maximalizáló megállás 8 pumpánál van a megadott paraméterekkel. | Az EV numerikus kiszámítása minden megállási pontra. |
| 3 | Az `adjusted_risk_index` csak a fel nem robbant léggömböket veszi. | Szintetikus futás ismert pumpaszámokkal; a robbantak kihagyása igazolt. |
| 4 | A `risk_calibration` pontszám **szimmetrikus**: 4 és 12 pumpa ugyanazt adja. | Két szintetikus futás; a score azonos. |
| 5 | A paklik 10 kártyás nettó egyenlege pontosan −250 / −250 / +250 / +250. | A generált ütemezés összegzése minden pakliban. |
| 6 | Két azonos seedű futás azonos robbanási pontokat, pakli-elhelyezést és veszteségsorrendet ad. | Két modul példány összehasonlítása. |
| 7 | Két különböző seed különböző pakli-elhelyezést ad. | Ugyanaz, eltérő seeddel. |
| 8 | A robbanási pont **soha nem jelenik meg** felhasználói szövegben. | Az összes megjelenített szöveg átvizsgálása; a napló viszont tartalmazza. |
| 9 | Sík platformon a `bart_approach` blokk nem fut, és az `approach_risk_shift` **hiányzik**, nem nulla. | Asztali és mobil futás blokk- és metrikalistája. |
| 10 | Sík platformon a `cue_independence` súlya kiesik, és a maradék négy súly összege 1,00. | Egységteszt mindkét súlylistára. |
| 11 | Mobilon a `reach_*` és a `pointer_*` metrika **egyaránt hiányzik**. | Mobil futás metrikalistája. |
| 12 | A `trials.correct` mező minden RISK-próbán `null`. | A generált trial rekordok ellenőrzése. |
| 13 | A `learning_slope` egy „végig A-t választok” stratégiánál nulla körüli, egy „a 2. blokktól C/D” stratégiánál pozitív. | Két szintetikus válaszsorozat. |
| 14 | A `decision_consistency` 1,0 egy állandó választásnál és 0,0 egy minden kártyánál váltó választásnál. | Két szintetikus sorozat. |
| 15 | A `bart_approach` blokkban a léggömb szögmérete végig 12,0° ± 0,2°. | A skálázás numerikus ellenőrzése a távolság függvényében. |
