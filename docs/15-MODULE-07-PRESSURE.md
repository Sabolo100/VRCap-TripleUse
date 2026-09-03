# 15 — MODUL 07: PRESSURE
## Teljesítmény kognitív nyomás alatt — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/pressure/PressureModule.ts`
**Támogatott platformok:** VR · asztali · mobil
**Névleges időtartam:** ~8 perc
**Doménkötés:** A elsődleges · B elsődleges · C elsődleges

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a PRESSURE azt méri, mennyivel romlik valakinek a döntési
pontossága és sebessége, amikor kevés az idő, zavaró inger van, és a szabály
menet közben megváltozik — és milyen gyorsan áll helyre egy hiba után.

### A modul tudományos gerince: a saját alapvonalhoz mért romlás

A modul **nem** abszolút teljesítményt pontoz. Minden fő mutatója
**személyen belüli különbség**: ugyanaz a feladat, ugyanaz a kéz, ugyanaz a
hardver, csak más körülmények között.

| Kontraszt | Mit izolál |
|---|---|
| inkongruens − kongruens | **interferencia-költség**: mennyire zavarja a nem releváns dimenzió |
| váltó − ismétlő próba | **váltási költség**: mennyibe kerül a szabályváltás |
| szabályváltás utáni 5 − előtti 5 | **szabályváltás-költség**: az újratanulás ára |
| hiba utáni − hiba előtti próba | **hiba utáni helyreállás** és lassulás |
| nyomás blokk − alapvonal blokk | **nyomás alatti romlás** |
| helyreállás blokk − alapvonal blokk | **visszatérés**: elmúlik-e a hatás |

Ez a szerkezet az, ami eszközosztályok között is értelmezhetővé teszi az
eredményt: a VR-lánc 40–70 ms többletlatenciája mindkét oldalról kiesik a
kivonásnál. Egy abszolút reakcióidő nem hordozza ezt a tulajdonságot.

### Miért ez a „choking” mérhető magja

A sportpszichológiában a nyomás alatti összeomlás azt jelenti, hogy a
teljesítmény **a saját, bizonyított szintje alá** esik akkor, amikor a tét nő.
Ennek két mérhető összetevője van, és a modul mindkettőt külön adja meg:

1. **`pressure_decrement`** — mennyivel romlik a pontosság a nyomás alatt a
   saját alapvonalhoz képest.
2. **`recovery_index`** — a nyomás megszűnte után visszatér-e az alapvonalra.
   Aki visszatér, annál a nyomás **átmeneti terhelés** volt. Aki nem, annál a
   hiba **beépült**, és ez a rosszabb mintázat.

A kettő együtt informatívabb, mint bármelyik önmagában: két sportoló azonos
nyomás alatti romlással gyökeresen különbözhet abban, hogy utána mi történik.

### Mért konstruktumok

| Konstruktum | Katalógus # | Blokk | Paradigma |
|---|---|---|---|
| Kognitív flexibilitás | 28 | 3 | Cued task switching |
| Figyelem nyomás alatt | 29 | 4 | Time pressure |
| Interferencia-kontroll | 6 | 2 | Dimenzionális Stroop |
| Időnyomásos döntés | 51 | 4 | Response deadline |
| Döntés bizonytalanságban | 52 | 4 | Rövidülő válaszablak |
| Hiba utáni helyreállás | 133 | 2–5 | Post-error adjustment |
| Szabályváltás költsége | 136 | 4 | Rule reversal |
| Teljesítmény-stabilitás | — | 1–5 | Blokkok közti variancia |

### Amit a modul NEM mér

- **Nem méri a stresszt.** Nem mér pulzust, bőrellenállást, kortizolt.
  Kognitív terhelést hoz létre, és a **teljesítményváltozást** méri. A
  megfogalmazás kötelezően „observed performance under time pressure”, nem
  „stressztűrés”.
- **Nem méri a szorongást** és nem szűr szorongásos zavarra.
- **Nem hoz létre traumát.** Nincs robbanás, nincs sérülés, nincs
  félelemkeltés. A terhelés: rövidülő idő, zavaró hang, látható pontszám,
  szabályváltás. Ez a kognitív pszichológiai laborokban rutinszerű terhelési
  szint.
- **Nem személyiségvonás.** A `pressure_decrement` egy adott napon, egy adott
  feladatban megfigyelt viselkedés. Ismételt méréssel válik jellemzővé.
- **Nem jósolja meg a versenyteljesítményt.** Ehhez kritérium-validitási
  vizsgálat kellene valós versenyeredményekkel összevetve.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** A büntetőrúgás, a döntő szett, a záró lövés
mind ugyanaz a szerkezet: ismert feladat, megnőtt tét, kevesebb idő.
A modul azt adja meg, hogy a sportoló teljesítménygörbéje hogyan viselkedik
ebben. A `recovery_index` edzésmódszertani szempontból a leghasznosabb:
aki egy hiba után szétesik, annak más felkészítés kell, mint akinek csak
lassabb, de pontos marad. Sportágak: büntetőrúgás, tenisz, sportlövészet,
küzdősportok, síugrás.

**A — Védelmi (elsődleges).** Nem a félelem, hanem a döntési képesség romlása
terhelés alatt. A szabályváltás-költség itt közvetlen: a beavatkozási szabályok
menet közben változhatnak, és aki a régi szabály szerint reagál tovább, az
veszélyes. Beosztások: minden harcoló beosztás, parancsnok, ellenőrzőpont-szolgálat.

**B — Munkaalkalmasság (elsődleges).** Riasztás, szövődmény, forgalmi
vészhelyzet. Az számít, hogy mennyire esik szét a teljesítmény, és milyen
gyorsan áll helyre egy hiba után — az utóbbi az egészségügyi és a repülési
hibakutatás központi kérdése. Munkakörök: sürgősségi orvos, légiirányító,
mentőtiszt, tőzsdei kereskedő, vezérlőterem-operátor.

---

## 3. FELADATSTRUKTÚRA

Az inger végig ugyanaz: **egy színes alakzat**. Két dimenziója van, és
mindkettő egy-egy válaszoldalhoz köthető:

| Dimenzió | Bal válasz | Jobb válasz |
|---|---|---|
| **SZÍN** | cián | magenta |
| **ALAK** | kocka | gömb |

Minden próba előtt egy **jelzés** mondja meg, melyik dimenzió a releváns.
Egy próba lehet:

- **kongruens** — a két dimenzió ugyanarra az oldalra mutat (cián kocka),
- **inkongruens** — ellentétes oldalra mutatnak (cián gömb),
- **semleges** — a nem releváns dimenzió nem köthető oldalhoz (szürke alakzat
  szín-próbában, illetve kúp alak-próbában).

Ez a dimenzionális Stroop-elrendezés lényege: az inger azonos marad, csak az
számít, mire kell figyelni.

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | ALAPVONAL | 6 | 28 | ~1:20 | a saját, kényelmes szintje |
| 2 | INTERFERENCIA | 6 | 36 | ~1:40 | interferencia-kontroll |
| 3 | VÁLTÁS | 6 | 40 | ~2:00 | kognitív flexibilitás |
| 4 | NYOMÁS | 4 | 44 | ~1:50 | romlás terhelés alatt + szabályváltás |
| 5 | HELYREÁLLÁS | 0 | 24 | ~1:10 | visszatér-e az alapvonalra |

### 3.1. Blokk 1 — Alapvonal

Egyetlen dimenzió végig: **SZÍN**. A jelzés minden próbában ugyanaz.
Csak kongruens és semleges próbák (nincs konfliktus).

```
PREPARE          400–800 ms    jelzés látszik ("SZÍN")
COUNTDOWN        0
STIMULUS         2000 ms       az alakzat megjelenik, válaszra vár
RESPONSE         0
FEEDBACK         500 ms gyakorláskor, 0 mérés közben
INTER-TRIAL      400 ms
```

**Miért kényelmes a válaszablak?** Mert ez az alapvonal: azt kell megmutatnia,
mire képes a résztvevő, amikor semmi nem szorítja. Ha az alapvonal is
szoros lenne, a 4. blokk romlása nem lenne értelmezhető.

### 3.2. Blokk 2 — Interferencia

Továbbra is egyetlen dimenzió (véletlenszerűen SZÍN vagy ALAK, de **blokkon
belül végig ugyanaz**), viszont most inkongruens próbák is vannak.

- **Eloszlás:** 50% kongruens, 33% inkongruens, 17% semleges.
- Az inkongruens próbák aránya szándékosan kisebb: ha többségben lennének, a
  résztvevő stratégiát váltana (elkezdené a nem releváns dimenziót aktívan
  elnyomni), és az interferencia-hatás eltűnne.

### 3.3. Blokk 3 — Váltás

A releváns dimenzió próbáról próbára változhat, és a jelzés **minden
próbában** megmondja, melyik.

- **Váltási arány:** 40% váltó, 60% ismétlő próba.
- **Jelzés-inger távolság (CSI):** 600 ms — elég a felkészülésre, de nem
  annyi, hogy a váltási költség eltűnjön.
- Az inkongruencia eloszlása azonos a 2. blokkéval.

**Váltási költség** = a váltó próbák RT-je mínusz az ismétlő próbáké,
csak a helyes válaszokon.

### 3.4. Blokk 4 — Nyomás

A tényleges terhelési blokk. Négy dolog változik egyszerre — szándékosan,
mert a valós nyomáshelyzet sem egyetlen tényezőből áll:

1. **Rövidülő válaszablak.** 1400 ms-ról indul, és próbánként 18 ms-mal
   csökken, 600 ms-os padlóig. Az utolsó próbák érdemben kényszerítenek.
2. **Zavaró hang.** Szabálytalan időközönként (900–2600 ms) rövid,
   200–1600 Hz közötti véletlen tónusok, halkan. Nem hordoznak információt.
3. **Látható tétszámláló.** „Sorozat: 7 · Kockán: 240 pont”. A sorozat egy
   hibánál nullázódik. Ez az értékelési nyomás analógja.
4. **Szabályváltás a blokk közepén.** A 22. próbánál a **válasz-hozzárendelés
   megfordul**: ami eddig balra ment, az mostantól jobbra. A jelzés kiírja,
   hogy „SZABÁLY MEGFORDULT”, de csak egyszer, 1500 ms-ig.

A késve érkező válasz `timeout`, és a sorozatot is nullázza.

### 3.5. Blokk 5 — Helyreállás

Pontosan az 1. blokk feltételei: egyetlen dimenzió (SZÍN), kényelmes
2000 ms-os ablak, nincs hang, nincs számláló, nincs szabályváltás.

**Ez a blokk nem díszlet.** Az `recovery_index` = a helyreállás blokk
pontossága mínusz az alapvonal pontossága. A nulla körüli érték a jó:
azt jelenti, a nyomás hatása nem tapadt meg.

---

## 4. INGERDEFINÍCIÓ

Egyetlen inger a látómező közepén, 2,2 m-re, szemmagasságban.

| Elem | Geometria | Méret | Szögméret | Szín |
|---|---|---|---|---|
| Kocka | box | 0,30 m | 7,8° | cián `#22D3EE` / magenta `#E879F9` / semleges szürke `#8B97A8` |
| Gömb | sphere | 0,32 m | 8,3° | ugyanaz |
| Kúp (semleges alak) | cone | 0,32 m | 8,3° | ugyanaz |
| Jelzőpanel | panel | 0,55 × 0,14 m | — | „SZÍN” vagy „ALAK” |
| Tétszámláló | panel | 0,7 × 0,16 m | — | csak a 4. blokkban |

**A színek megkülönböztethetősége.** A cián és a magenta a színkörön
szemben helyezkedik el, és világosságuk közel azonos — így a
megkülönböztetés valóban színinformáción alapul, nem fényerőn.
Vörös-zöld színtévesztés esetén is elkülönülnek; ez szándékos választás,
hogy a modul ne szűrjön ki akaratlanul színtévesztőket.

**Hang.**
- Inger megjelenése: 1400 Hz kattanás (28 ms) — minden blokkban.
- Gyakorláskor helyes 880 Hz, hibás 180→120 Hz.
- 4. blokk zavaró hangjai: véletlen tónus 200–1600 Hz, 90–160 ms, 0,12 hangerő,
  900–2600 ms közönként. **Nem esik egybe az ingerrel** (legalább 250 ms
  távolság), különben időzítési jelzéssé válna.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1–5 mind | `equivalent` | Két diszkrét válasz és egy központi inger — mindhárom platformon azonos. |

Ez a platform szempontjából a legjobban viselkedő modul: nincs benne
mutatás, követés vagy perifériás inger, tehát semmit nem kell adaptálni.
Az abszolút RT-k eszközosztályonként eltérnek, de a modul minden fő mutatója
különbség, amelyből ez kiesik.

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Inger távolsága | 2,2 m | 2,2 m | 2,2 m |
| Panel távolsága | 1,9 m | 1,35 m | 1,35 m |
| Válaszmód | bal/jobb ravasz | `F` / `J` vagy nyilak | bal/jobb képernyőharmad |

### Platformonként kieső metrikák

Egy sem. Minden metrika mindhárom platformon értelmes.

### Irányítási szöveg platformonként

| VR | Asztali | Mobil |
|---|---|---|
| „CIÁN vagy KOCKA → bal ravasz. MAGENTA vagy GÖMB → jobb ravasz. A jelzés mondja meg, melyik számít.” | „CIÁN vagy KOCKA → F billentyű. MAGENTA vagy GÖMB → J billentyű.” | „CIÁN vagy KOCKA → koppints a bal harmadra. MAGENTA vagy GÖMB → a jobb harmadra.” |

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: a válaszablak hossza, az inkongruens próbák aránya, a
váltási arány, a jelzés-inger távolság, a zavaró hang sűrűsége, a
szabályváltások száma.

### `PRESSURE_STANDARD_A` (alapértelmezés)

```
baselineTrials 28   window 2000   dimension COLOR
interferenceTrials 36   window 2000   congruent .5 incongruent .33 neutral .17
switchTrials 40   window 2000   switchRate .40   csiMs 600
pressureTrials 44   windowStart 1400  windowStep -18  windowFloor 600
                    distractorMs [900,2600]  reversalAt 22
recoveryTrials 24   window 2000   dimension COLOR
```

### `PRESSURE_SHORT` (~4,5 perc)

```
baselineTrials 16   interferenceTrials 20   switchTrials 24
pressureTrials 26 (reversalAt 13)   recoveryTrials 14
```

### CHALLENGE mód

A válaszablak adaptívan követi a résztvevő teljesítményét (75%-os
pontossági célra hangolva), és van élő pontszám. **Az assessment
eredménnyel nem keverhető**, mert az adaptív ablak miatt a
`pressure_decrement` definíciója megszűnik: mindenki ugyanoda kerül.

---

## 7. METRIKÁK

### Nyers (próbánként)
`block` · `dimension` (`color` / `shape`) · `congruency` · `isSwitch` ·
`shapeKind` · `colorKind` · `requiredSide` · `chosenSide` · `correct` ·
`reactionTimeMs` · `windowMs` · `afterReversal` · `streakAtTrial` ·
`postError` (az előző próba hibás volt-e)

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `baseline_accuracy` | Helyes / összes az 1. blokkban |
| `baseline_rt` | Medián RT a helyes alapvonal-próbákon |
| `interference_cost_rt` | Medián RT(inkongruens) − medián RT(kongruens), helyes próbákon, a 2. és 3. blokk összevonva |
| `interference_cost_accuracy` | Pontosság(kongruens) − pontosság(inkongruens) |
| `switch_cost_rt` | Medián RT(váltó) − medián RT(ismétlő), helyes próbákon, 3. blokk |
| `switch_cost_accuracy` | Pontosság(ismétlő) − pontosság(váltó) |
| `rule_change_cost` | Pontosság(a megfordulás előtti 5 próba) − pontosság(utáni 5), 4. blokk |
| `rule_change_rt_cost` | Ugyanez RT-ben |
| `post_error_slowing` | Medián RT(hiba utáni próba) − medián RT(helyes utáni próba) |
| `post_error_accuracy` | Pontosság a hiba utáni próbákon |
| `post_error_recovery` | Pontosság(hiba utáni) / pontosság(hiba előtti); 1 körül = stabil |
| `pressure_decrement` | `baseline_accuracy` − `pressure_accuracy`; pozitív = romlott |
| `pressure_rt_change` | `pressure_rt` − `baseline_rt` (negatív, mert az ablak szorít) |
| `pressure_timeout_rate` | Válasz nélkül lejárt próbák aránya a 4. blokkban |
| `recovery_index` | `recovery_accuracy` − `baseline_accuracy`; 0 körül = teljes helyreállás |
| `stability` | 1 − (a blokkonkénti pontosságok szórása / átlaga) |
| `speed_accuracy_shift` | A gyors és lassú félidő pontosságkülönbsége a 4. blokkban |
| `max_streak` | A leghosszabb hibátlan sorozat a 4. blokkban |

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `accuracy_under_load` | 95% pontosság a 4. blokkban | 55% | 50% = véletlen |
| `pressure_resilience` | `pressure_decrement` 0 | 0,35 | **Provizórikus**; 35 pontnyi romlás jelentős összeomlás |
| `recovery` | `recovery_index` 0 | −0,25 | A 0 fölötti (javuló) érték is 100 |
| `interference_control` | interferencia-költség 20 ms | 180 ms | Stroop-tartomány, **provizórikus** |
| `flexibility` | váltási költség 40 ms | 350 ms | Váltási költség tipikus tartománya |
| `error_recovery` | `post_error_accuracy` 0,95 | 0,55 | |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Pontosság terhelés alatt | 0,24 |
| Nyomásállóság (romlás) | 0,22 |
| Helyreállás a nyomás után | 0,16 |
| Interferencia-kontroll | 0,14 |
| Kognitív flexibilitás | 0,14 |
| Hiba utáni helyreállás | 0,10 |

A romlás és a helyreállás együtt 38% — ez a modul lényege, nem a nyers
pontosság.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `cue_shown` | dimension, block, csiMs |
| `stimulus_onset` | dimension, congruency, shapeKind, colorKind, requiredSide, windowMs, isSwitch, afterReversal, quantisationMs |
| `response` | chosenSide, correct, rtMs, postError, streak |
| `timeout` | windowMs, dimension |
| `rule_reversal` | trialIndex, newMapping |
| `distractor_tone` | freq, durationMs |
| `streak_broken` | atTrial, length |
| `block_summary` | block, accuracy, medianRt, timeouts |

**Mozgásnaplózás: 5 Hz.** Ez a modul nem mér mozdulatot; a fej és a kéz
helyzete csak arra kell, hogy utólag kizárható legyen egy futás, ahol a
résztvevő nyilvánvalóan elfordult a feladattól. Sűrűbb mintavétel csak
tárhelyet fogyasztana.

---

## 9. ADATBÁZIS

Új tábla nem kell.

```jsonc
// trials.stimulus
{ "kind": "pressure", "block": "switch", "dimension": "shape",
  "congruency": "incongruent", "shapeKind": "sphere", "colorKind": "cyan",
  "requiredSide": "right", "isSwitch": true, "windowMs": 2000,
  "afterReversal": false, "practice": false }

// trials.response
{ "rtMs": 612.4, "chosenSide": "right", "postError": false, "streak": 4 }
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „PRESSURE / Teljesítmény kognitív nyomás alatt”, öt blokk.
   Egy mondat kiírva: *„Nem lesz benne semmi ijesztő. Kevesebb idő lesz,
   zavaró hangok, és a szabály meg fog változni.”* — az elvárás beállítása
   önmagában is csökkenti a nem kívánt szorongási komponenst.
2. **INSTRUKCIÓ** blokkonként. A 2. blokknál kiemelve: *„A jelzés mondja meg,
   melyik dimenzió számít. A másik dimenzió szándékosan zavarni fog.”*
3. **GYAKORLÁS** visszajelzéssel.
4. **„MOST JÖN A MÉRÉS”**.
5. **MÉRÉS**.
6. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Pontosság nyomás alatt | `84%` (alapvonal `96%`) |
| Nyomás alatti romlás | `12 pont` |
| Helyreállás | `−2 pont` |
| Interferencia-költség | `62 ms` |
| Váltási költség | `118 ms` |
| Hiba utáni pontosság | `89%` (lassulás `74 ms`) |

Az eredményképernyő alján a terület figyelmeztetése, sportban kiegészítve:
*„A nyomás alatti romlás edzhető. Ez a szám a mai állapotot mutatja, nem
állandó tulajdonságot.”*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A 2. blokk dimenzionális Stroop-elrendezés: az inger két
dimenziója versenyez, és csak az egyik releváns. A 3. blokk jelzéssel
vezérelt feladatváltás. A 4. blokk válasz-határidős elrendezés, kiegészítve
szabály-megfordítással. A hiba utáni lassulás és pontosság klasszikus
post-error adjustment mutatók.

**Eltérések.** (a) Az eredeti Stroop szó–szín konfliktusra épül, ami olvasási
automatizmust használ ki; itt szín–alak konfliktus van, ami gyengébb, de
nyelvfüggetlen és írástudástól független — ez felmérési környezetben előny.
(b) A válasz-határidős elrendezésekben a határidő általában rögzített szintekkel
változik; itt folyamatosan csökken, ami ökológiailag jobban hasonlít a
felfokozódó versenyhelyzetre, de a pszichofizikai küszöbszámítást megnehezíti.
(c) A tétszámláló nem valódi tét: nincs mögötte következmény. Az értékelési
nyomás így gyengébb, mint egy valós versenyhelyzetben.

**Elvárt nagyságrendek** (egészséges felnőtt):
alapvonal-pontosság 92–99% · alapvonal RT 480–750 ms ·
interferencia-költség 25–120 ms · váltási költség 60–250 ms ·
nyomás alatti romlás 3–20 pont · hiba utáni lassulás 20–120 ms ·
helyreállási index −8 és +3 pont között. Asztali billentyűzettel az RT-k
80–150 ms-mal alacsonyabbak, a **különbségek nagyjából változatlanok**.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
szorongás, alkalmatlanság versenysportra, sem munkaköri alkalmatlanság.
A nagy `pressure_decrement` felkészítési feladatot jelöl ki, nem ítéletet.

**Tanulási hatás.** Az interferencia- és váltási költség 2–3 felvétel után
stabilizálódik. A `pressure_decrement` **csökken** ismételt felvétellel,
mert a szabály-megfordítás már nem meglepetés — ezért ismételt mérésnél a
megfordítás helye seedből változik, és longitudinális összehasonlításnál
kötelező feltüntetni a felvétel sorszámát.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. Az 1. és az 5. blokk paraméterei bitre azonosak (dimenzió, ablak,
   inger-eloszlás), különben a `recovery_index` értelmezhetetlen.
2. A 2. blokk inger-eloszlása 50% kongruens, 33% inkongruens,
   17% semleges, ±1 próba pontossággal.
3. A 3. blokkban a váltó próbák aránya 40% ± 1 próba, és az első próba
   soha nem minősül váltónak.
4. A 4. blokkban a válaszablak 1400 ms-ról indul, próbánként 18 ms-mal
   csökken, és soha nem megy 600 ms alá.
5. A szabály-megfordítás pontosan a 22. mért próbánál történik, és a
   megfordítás után a helyes oldal minden inger-kombinációra az ellentétes.
6. A zavaró hang soha nem szól az inger megjelenése előtti vagy utáni
   250 ms-on belül.
7. Késve érkező válasz `timeout` kimenetet ad, és nullázza a sorozatot.
8. Két azonos seedű futás azonos inger-, kongruencia- és váltási sorozatot ad.
9. A gyakorló próbák nem kerülnek a pontozásba.
10. Mérés közben nincs visszajelzés a helyességről (a tétszámláló csak
    a 4. blokkban látszik, és az szándékos terhelési elem).
11. Minden `stimulus_onset` esemény tartalmaz `quantisationMs` mezőt.
12. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
13. Szintetikus profilokon (rugalmas / átlagos / összeomló) az OPS pontszám
    monoton csökkenő, legalább 180 pont különbséggel a szélsők között.
14. Egy „összeomló” szintetikus profil (nagy romlás, gyenge helyreállás)
    alacsonyabb `pressure_resilience` és `recovery` score-t kap, mint egy
    azonos nyers pontosságú, de stabil profil.

---

# B VÁLTOZAT — TÉRBELI INTERFERENCIA ÉS FIGYELMI SZŰKÜLÉS (`PRESSURE_SPATIAL_B`)

Ez a fejezet a modul **B változatát** írja le. Az A változat (1–12. fejezet)
változatlan és minden platformon fut. A B változat **kizárólag VR-ben** érhető el.

## B/1. Miért van B változat

Az A változat nyomás alatti döntést mér: fogyó válaszablak, zavaró ingerek, tét.
A laposítási teszten megbukik — minden ingere egy homloksíkon van, és minden
metrikája ugyanaz maradna egy monitoron.

A B változat két olyan jelenséget mér, amit lapos kijelzőn nem lehet:

1. **Térbeli inger–válasz kompatibilitás mélységben.** A Simon-hatás
   klasszikusan bal–jobb; a válasz iránya és az inger helye ütközik. VR-ben a
   válasznak van egy harmadik tengelye is — **előre–hátra** —, és az ingernek is.
   A mélységi Simon-hatás megléte azt mutatja, hogy a résztvevő térbeli
   reprezentációja valóban háromdimenziós, nem csak vetületi.
2. **Figyelmi szűkülés (attentional narrowing / tunnel vision).** Ez a stressz
   legjobban dokumentált perceptuális következménye, és **definíció szerint a
   látómező széléről szól**. Egy 50°-os monitoron nincs látómezőszél, ezért
   lapos platformon a jelenség nem mérhető, csak szimulálható.

## B/2. Térbeliség — a modul létjogosultsága

**Laposítási kérdés:** lapítás után a `depth_simon_effect`,
a `depth_simon_accuracy_cost`, a `depth_response_rt`, az
`attentional_narrowing_slope`, a `peripheral_outer_loss` és minden
`peripheral_hit_*` metrika eltűnik. Az OPS 30%-a (a `field_stability` és a
`depth_interference_control` együtt) szerkezetileg megszűnik. Térbeli.

| Affordancia | Metrika |
|---|---|
| **Surround** — a látómező széle valóban létezik | `peripheral_hit_20/40/60_early/late`, `attentional_narrowing_slope`, `peripheral_outer_loss` |
| **Depth** — a válasz tengelye is lehet mélységi | `depth_simon_effect`, `depth_simon_accuracy_cost`, `depth_response_rt` |
| **Peripersonal** — a válasz mozdulat, nem gombnyomás | a mélységi válasz a kontroller ki- és behúzása |
| **Rotation** — szilárd, forgó ingerek | az inger azonosítása nézőpontfüggetlen marad |

## B/3. Feladatstruktúra

| # | Blokk | Próba | Gyakorlás | Cél |
|---|---|---|---|---|
| 1 | `baseline` — ALAPVONAL | 28 | 6 | nyomás nélküli alapteljesítmény |
| 2 | `simon` — HELY–VÁLASZ ÜTKÖZÉS | 40 | 6 | oldalirányú Simon-hatás |
| 3 | `depthsimon` — MÉLYSÉGI ÜTKÖZÉS | 36 | 6 | mélységi Simon-hatás |
| 4 | `squeeze` — NYOMÁS | 48 | 5 | fogyó ablak + periferiális szondák |
| 5 | `recovery` — HELYREÁLLÁS | 24 | 0 | visszatér-e az alapvonalra |

**Szabály.** Végig ugyanaz: **CIÁN → bal, MAGENTA → jobb**. A szín számít, a hely
soha. Ez a Simon-paradigma lényege: a helyinformáció irreleváns, mégsem lehet
figyelmen kívül hagyni.

**2. blokk.** Az inger a válasszal egyező (kongruens) vagy ellentétes (inkongruens)
oldalon jelenik meg. Az arány **50% kongruens / 34% inkongruens / 16% semleges**
(a semleges inger a középvonalon, 0–6°-on belül jelenik meg). Az inkongruens
próbák kisebbségben tartása szándékos: ha az inkongruencia lenne a többség, a
résztvevő megtanulná figyelmen kívül hagyni a helyet, és a Simon-hatás eltűnne.
A `simon_effect` az inkongruens és kongruens próbák medián RT-jének különbsége.

**3. blokk.** A válasz tengelye **mélységi**: a kontroller **0,18 m-nél nagyobb**
elmozdítása a nézőirány mentén előre a „távoli”, hátra a „közeli” válasz. Két
gyűrű jelöli a válaszzónákat (0,34 m, kék = közeli, narancs = távoli). Az inger
hol közel (**1,5 m**), hol távol (**3,6 m**) jelenik meg, és ez ütközhet a
helyes válasszal; a kongruenciaarány ugyanaz, mint a 2. blokkban.

A közeli és a távoli inger **fizikai mérete a távolsággal arányos** (0,24 m ×
`r/1,5`), tehát a **szögméretük azonos** — a mélységet kizárólag a diszparitás
hordozza. E nélkül a „mélységi inger” valójában méretinger lenne.

A válaszablak itt 2600 ms, mert egy mozdulat lassabb, mint egy gombnyomás — a
mért mennyiség az interferencia, nem a mozgás sebessége.

**4. blokk.** A válaszablak lineárisan szűkül **1400 ms-ról 600 ms-ra** a blokk
folyamán (`windowFor`), közben véletlen zavaró hangok (200–1600 Hz, 900–2600 ms-onként)
és látható sorozatszámláló (`stakePanel`) növeli a tétet. **Minden harmadik próbához**
periferiális szonda társul **20°, 40° vagy 60°** excentricitáson, amit a
**másodlagos gombbal (grip)** kell nyugtázni — így a periferiális válasz soha nem
verseng a központi feladat bal/jobb válaszával.

**5. blokk.** Az 1. blokk feltételei, hang és számláló nélkül. A `recovery_index`
a helyreállási és az alapvonal-pontosság különbsége.

## B/4. A figyelmi szűkülés mérése

Ez a modul zászlóshajó-metrikája, ezért külön fejezetet kap.

A `squeeze` blokk két felében külön számoljuk a periferiális szondák
találati arányát mindhárom excentricitáson:

```
peripheral_hit_20_early   peripheral_hit_20_late
peripheral_hit_40_early   peripheral_hit_40_late
peripheral_hit_60_early   peripheral_hit_60_late
```

A **veszteség** excentricitásonként `early − late`. Az
`attentional_narrowing_slope` ezen veszteségek regressziós meredeksége az
excentricitásra. Értelmezése:

| Érték | Jelentés |
|---|---|
| ≈ 0 | a nyomás egyenletesen érinti a látómezőt (általános teljesítményesés) |
| > 0 | **szűkülés**: a periféria aránytalanul többet veszít, mint a közép |
| < 0 | a közép veszít többet — ritka, jellemzően az egész feladat feladását jelzi |

Ez a megkülönböztetés azért fontos, mert a puszta teljesítményesés és a
figyelmi mező összeszűkülése **más beavatkozást igényel** — az egyik terhelés-,
a másik pásztázási probléma. Lapos platformon a kettő nem választható szét.

## B/5. Ingerdefiníció

| Elem | Primitív | Méret | Szín |
|---|---|---|---|
| Központi inger | gömb | 0,16 m átmérő | CIÁN / MAGENTA |
| Periferiális szonda | gömb | 0,16 m, mindig 3,0 m-en | fehér |
| Tét-panel | sík | 0,66 × 0,15 m | — |
| Visszajelzés | sík | 0,70 × 0,16 m | — |

A periferiális szonda **mindhárom excentricitáson azonos fizikai méretű és azonos
távolságban** van (0,16 m, 3,0 m sugarú gömbhéjon), ezért a **szögmérete
konstrukció szerint azonos**. E nélkül a „periférián nehezebb észrevenni”
eredmény triviálisan következne a kisebb látszó méretből, és nem a figyelemről szólna.
A szonda 260 ms-ig látszik, a válaszablak 1100 ms.

A központi ingerek lassan forognak (0,2–0,5 rad/s), ami mozgásparallaxist ad; a szín
azonosítását ez nem befolyásolja.

## B/6. Keresztplatform leképezés

`supports: ['vr']`.

| Elem | VR | Miért nincs lapos megfelelője |
|---|---|---|
| Mélységi válasz | kontroller előre/hátra mozdítása | az egérnek nincs mélységi tengelye |
| 60°-os periferiális szonda | valós látómezőszél | 50°-os FOV-on nem létezik |
| Excentricitás-skála | 20 / 40 / 60° | lapos megfelelője 12 / 18 / 24° volna, ami nem periféria |

A kód lapos platformon 12 / 18 / 24°-os szondákat tudna elhelyezni, de ezt
**nem tekintjük ugyanannak a mérésnek** — 24° nem a látómező széle. Ezért a B
változat lapos platformon nem indul el.

## B/7. Metrikák

| Metrika | Definíció | Egység |
|---|---|---|
| `simon_effect` | inkongruens − kongruens medián RT (oldalirányú) | ms |
| `depth_simon_effect` | ugyanez a mélységi választengelyen | ms |
| `depth_simon_accuracy_cost` | a pontosság esése inkongruens mélységi próbákon | arány |
| `accuracy_under_load` | pontosság a `squeeze` blokkban | arány |
| `pressure_decrement` | `baseline_accuracy − accuracy_under_load` | arány |
| `recovery_index` | `recovery_accuracy − baseline_accuracy` | arány |
| `attentional_narrowing_slope` | a periferiális veszteség meredeksége az excentricitásra | arány/fok |
| `peripheral_outer_loss` | veszteség 60°-on (`early − late`) | arány |
| `stability` | a blokkonkénti pontosságok szórásának inverze | arány |

**OPS SCORE:**

| Összetevő | Súly (VR) | Súly (lapos) |
|---|---|---|
| `accuracy_under_load` | 0,22 | — |
| `pressure_resilience` | 0,20 | — |
| `spatial_interference_control` | 0,16 | — |
| `field_stability` | 0,16 | **0** |
| `depth_interference_control` | 0,14 | — |
| `recovery` | 0,12 | — |

## B/8. Validáció és korlátok

**Származás.** Simon (1969) inger–válasz kompatibilitási paradigmája; a mélységi
kiterjesztés a térbeli kódolás háromtengelyes modelljét követi. A figyelmi
szűkülés Easterbrook cue-utilization hipotézisére és a stressz alatti
periferiális detekció szakirodalmára épül (a repülés- és vezetéskutatásban
használt peripheral detection task logikájával).

**Eltérés.** A klasszikus periferiális detekciós feladatoknál a szonda fix
excentricitáson van; itt három szint van és a szögméret kompenzált, ami
lehetővé teszi a **meredekség** becslését, nem csak egyetlen pont mérését.

**Elvárt nagyságrend** egészséges felnőttnél: `simon_effect` 20–45 ms,
`depth_simon_effect` 25–70 ms (nagyobb, mert a mozdulat lassabb kódolású),
`pressure_decrement` 0,04–0,15, `attentional_narrowing_slope` 0,000–0,004 arány/fok.

**Amit nem szabad kikövetkeztetni:** stressztűrést mint személyiségvonást.
A modul megfigyelt teljesítményt mér időnyomás alatt, egyetlen alkalommal.
A „figyelmi szűkülés” itt egy mért perceptuális jelenség, nem alkalmassági ítélet.

**Fontos korlát.** A modul nem mér élettani stresszválaszt (pulzus, bőrvezetés),
mert a Quest 3 alapkonfigurációja nem adja. Amit „nyomásnak” nevezünk, az
kizárólag feladatkényszer: fogyó ablak, zavaró inger, látható tét.

## B/9. Elfogadási kritériumok

1. A periferiális szondák szögmérete mindhárom excentricitáson legfeljebb 3%-kal tér el.
2. A periferiális válasz gombja soha nem azonos a központi feladat válaszgombjaival.
3. A `squeeze` blokk válaszablaka az utolsó próbánál pontosan 600 ms.
4. A `simon` és a `depthsimon` blokk kongruencia-aránya 50 / 34 / 16% ±1 próba.
5. A `depthsimon` blokkban a válasz csak 0,18 m-nél nagyobb, nézőirány menti
   elmozdulásra kerül elfogadásra, és a közeli/távoli inger szögmérete azonos.
6. Mindhárom excentricitás mindkét blokkfélben legalább 4 szondát kap.
7. A B változat lapos platformon nem indítható; a kártyagomb letiltott és indokolt.
8. Azonos seed azonos kongruencia- és szondasorrendet ad.
9. Egy teljes B futás 12–15 perc.
10. A `recovery` blokkban nincs hang, nincs tét-panel, és a válaszablak fix.
