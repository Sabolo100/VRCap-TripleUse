# 27 — MODUL 18 · PROTOCOL · Eljárásrendi fegyelem & ellenőrzőlista

**Kód:** `PROTOCOL` · **Sorszám:** 18 · **Verzió:** 0.1.0
**Konfiguráció:** `PROTOCOL_STANDARD_A` (alap), `PROTOCOL_SHORT` (rövid)
**Platform:** VR · asztali · mobil — **eltérő elrendezéssel** (lásd 5.)
**Paradigmák:** ellenőrzőlista-követés, prospektív memória, megszakítás utáni
helyreállás (resumption lag, Trafton et al., 2003)
**Kapcsolódó dokumentumok:** `00-MASTER-SPEC.md` 5/18, `02-CROSSPLATFORM-INTERACTION.md`,
`03-SPATIAL-DESIGN.md`

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban.** A PROTOCOL azt méri, **mennyire pontosan és sorrendhelyesen
hajt végre a felhasználó egy megtanult, tíz lépéses eljárást** — tiszta
körülmények között, megszakítás után, időnyomás alatt, és akkor, amikor az
eljárás egy lépése menet közben megváltozik.

A fő mutató nem az, hogy tudja-e az eljárást. Az, hogy **hol veszíti el**.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Honnan |
|---|---|---|
| Eljáráskövetés | A helyes lépések aránya a megtanult sorrendben | checklist compliance |
| Prospektív memória | Egy megkezdett, félbehagyott szándék visszaidézése külső jelzés nélkül | Trafton et al. |
| Megszakítás utáni helyreállás | A megszakítás vége és az első helyes lépés közti idő | resumption lag |
| Szabálymegtartás | Az eljárás betartása akkor is, amikor a gyorsaság jutalmazna | compliance under pressure |
| Sorrendmemória | A tíz lépés sorrendjének megőrzése (katalógus 88) | sequence memory |

### Amit a modul kifejezetten NEM mér

- **Nem méri a szakmai tudást.** Az eljárás absztrakt: kapcsolók, szelepek és
  visszaigazolások, semmilyen valós ellenőrzőlista tartalma nélkül. Ez
  szándékos — különben azt mérnénk, ki dolgozott már hasonló géppel.
- **Nem méri a lelkiismeretességet** vagy bármilyen személyiségvonást.
- **Nem szimulál valós munkahelyi eljárást**, és nem helyettesíti a
  munkahelyi betanítást vagy annak ellenőrzését.
- **Nem méri az olvasási sebességet.** Az eljárás a mérés kezdetére
  megtanult; a lépések nincsenek kiírva a végrehajtás alatt.
- **Nem méri a stressztűrést.** Az időnyomás egy kísérleti feltétel, nem
  stresszor.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**B — munka (`primary`).** A repülésben és az egészségügyben a súlyos hibák
nagy része nem tudáshiány, hanem **kihagyott ellenőrzőlista-lépés
megszakítás után**. A modul pontosan ezt a mechanizmust méri, nem az
elméleti tudást — ezért az itt kapott `resumption_lag` és
`post_interruption_error_rate` a legközvetlenebbül releváns mutatói a
platformnak ezekben a szakmákban.
*Munkakörök:* pilóta, ápoló, gyógyszerész, vegyipari operátor, laborvezető,
műtőssegéd.

**A — védelmi (`secondary`).** Fegyverellenőrzés, rádióeljárás,
ellenőrzőpont-protokoll: mind rögzített sorrendű, megszakításnak kitett
eljárás. Másodlagos, mert a védelmi kiválasztásban ritkán ez a szűk
keresztmetszet.
*Munkakörök:* fegyverkezelés, híradó eljárás, ellenőrzőpont-szolgálat.

**C — sport (`none`).** A bemelegítési és versenyrutin-fegyelem közvetetten
érintett, de a modul absztrakt eljárása messze esik tőle, és a
sportterületen a mérési idő értékesebben tölthető. A modul a C területen
alapból nem jelenik meg.

---

## 3. FELADATSTRUKTÚRA

### 3.1. Az eljárás

Hat **állomás**, mindegyiken három **kezelőszerv** (összesen 18). Az eljárás
**10 lépés**, mindegyik egy konkrét kezelőszerv működtetése, rögzített
sorrendben. Két egymást követő lépés soha nincs ugyanazon az állomáson —
tehát minden lépés helyváltoztatást (VR-ben fejfordítást) igényel.

A kezelőszervek típusai:

| Típus | Művelet | Visszajelzés |
|---|---|---|
| Kapcsoló | átbillentés | a kar átáll, a lámpa színt vált |
| Szelep | elforgatás a jelölt állásba | a mutató odaáll |
| Visszaigazoló | egyszeri megnyomás | rövid felvillanás |

A típus nem hordoz mérési információt — a változatosság célja, hogy a tíz
lépés megkülönböztethető emlék legyen, ne tíz azonos gombnyomás.

### 3.2. Blokkok

| # | Blokk | Cél | Végrehajtás | Gyakorlás | `unitLabel` |
|---|---|---|---|---|---|
| 1 | `learn` | Az eljárás megtanulása és visszaellenőrzése | 3 vezetett + 1 önálló | 0 | `menet` |
| 2 | `baseline` | Tiszta végrehajtás, alapvonal | 2 menet | 0 | `menet` |
| 3 | `interrupted` | Végrehajtás megszakításokkal | 2 menet, menetenként 2 megszakítás | 0 | `menet` |
| 4 | `revised` | Időnyomás, majd módosított eljárás | 2 menet | 0 | `menet` |

**Nincs külön gyakorlóblokk.** A `learn` blokk **maga** a gyakorlás, és
mérünk is benne (a negyedik, önálló menet a `sequence_recall_accuracy`).
Ez eltérés a platform általános szabályától, ezért ki van mondva: egy
eljárásrendi modulban a betanulás nem előkészület, hanem a mérés első
szakasza.

**Idő:** `learn` ~170 s, `baseline` ~90 s, `interrupted` ~150 s,
`revised` ~120 s → kb. 530 s, instrukcióval és eredménnyel együtt kb. 9 perc.

`PROTOCOL_SHORT`: `learn` 2 vezetett + 1 önálló, a többi blokk 1-1 menet → ~300 s.

### 3.3. A menet anatómiája

```
PREPARE          minden kezelőszerv alaphelyzetben; a lépésszámláló nullázva
COUNTDOWN        3 s „FELKÉSZÜLÉS”
STIMULUS         a menet indul. Vezetett menetben a soron következő
                 kezelőszerv kivilágítva; önálló menetben SEMMI nem világít
RESPONSE WINDOW  menetenként 90 s (időnyomásos menetben 38 s, láthatóan)
RESPONSE         a helyes kezelőszerv működtetése
FEEDBACK         csak a `learn` blokkban: helyes = zöld, helytelen = piros
INTER-TRIAL      6 s szünet a menetek között
```

**A hibás lépés nem állítja meg az eljárást.** Ha rossz kezelőszervet
működtetnek, a lépés `wrong_control` eseményként rögzül, és a várt lépés
**továbbra is a várt lépés marad**. Ez fontos: ha a rendszer „továbbengedné”
őket, a sorrendhibák és a kihagyások összemosódnának.

**Kihagyás.** Ha a soron következő helyett egy **későbbi** lépés
kezelőszervét működtetik, akkor a köztes lépés(ek) `omitted` állapotba
kerülnek, és a végrehajtás onnan folytatódik. Ez a valós ellenőrzőlista-hiba
mintázata: nem megállás, hanem átugrás.

### 3.4. A megszakítás

A 4. és a 8. lépés **után** (± 1 lépés véletlen eltolással) egy panel jelenik
meg egy olyan állomáson, ami **nem** része az aktuális eljárás-környezetnek,
és hangjelzés kíséri. A megszakító feladat:

> Négy alakzat közül melyik nem illik a többihez? — négyszer egymás után.

Időtartam: 10–13 s (a négy válasz üteme szerint). A megszakítás **kötelező**:
addig nem lehet visszatérni, amíg a négy válasz meg nem született. A panel
eltűnésének pillanata a `resumption_lag` nullpontja.

A megszakító feladat szándékosan **nem** procedurális és nem térbeli:
alakzatválasztás, hogy a megszakítás a helyben-tartást terhelje, ne egy
másik sorrendet írjon felül.

### 3.5. Az eljárásmódosítás

A `revised` blokk második menete előtt egyetlen képernyő:

> **VÁLTOZÁS.** A **6.** lépés mostantól nem a *bal felső kapcsoló*, hanem a
> *jobb alsó szelep*. Minden más marad.

A képernyő 8 s-ig látszik, és nem ismételhető meg. Ezután a menet
figyelmeztetés nélkül indul. A `perseveration_rate` azt méri, hányszor
működtetik mégis a régi kezelőszervet.

---

## 4. INGERDEFINÍCIÓ

Minden állomás egy canvas-textúrás panel (0,50 × 0,34 m, logikai vászon
520 × 354 px), 2,0 m-en, a `BodyAnchor`-hoz igazítva.

| Elem | Rajz | Alaphelyzet | Működtetve |
|---|---|---|---|
| Kapcsoló | álló téglalap + kar | kar lent, lámpa `textMuted` | kar fent, lámpa `ok` |
| Szelep | kör + mutató | mutató 0°-on | mutató a jelölt állásban, gyűrű `accent` |
| Visszaigazoló | lekerekített gomb | `surfaceAlt` | 400 ms `accent2` felvillanás |
| Kivilágítás (csak `learn`) | 4 px `accent` keret a kezelőszerv körül | — | — |
| Állomásfelirat | 1–6 szám a panel bal felső sarkában | — | — |

**Térbeli elrendezés.**

| | VR | asztali | mobil (fekvő) |
|---|---|---|---|
| Elrendezés | **teljes körben**, 60°-onként: 0°, ±60°, ±120°, 180° | 3 × 2 rács | 3 × 2 rács |
| Azimut | lásd fent | −26°, 0°, +26° | −26°, 0°, +26° |
| Elevatio | 0° | +10° / −10° | +10° / −10° |
| Panel szélesség | 0,50 m | 0,46 m | 0,40 m |
| Egyszerre látható | legfeljebb 2 | mind a 6 | mind a 6 |

A Quest 3 vízszintes fél-látómezeje ≈ 55°, a panel fél-szélessége 7,2°:
a 60°-os szomszéd széle 52,8°-nál kezdődik, tehát **részben** látszik, a
120°-os egyáltalán nem. Ez adja a modul térbeli lényegét: az
ellenőrzőlista soha nem látható egészben, és a megszakítás után **vissza
kell találni** ahhoz az állomáshoz, ahol abbahagytuk.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

### 5.1. Besorolás

| Feladatelem | Osztály | Indoklás |
|---|---|---|
| Kezelőszerv működtetése | `equivalent` | mutatás és megerősítés, a *hova* nem konstruktum |
| Sorrend megtartása | `equivalent` | tisztán emlékezeti |
| Megszakító feladat | `equivalent` | alakzatválasztás |
| **Körülvevő elrendezés** | `vr-only` | hat állomás 360°-on egy 75°-os látómezőben nem létezik |
| **A helyreállás bontása** | `vr-only` | tájékozódási és döntési idő csak fejiránnyal választható szét |

### 5.2. Amit a térbeliség hozzátesz

A `resumption_lag` klasszikus, sík mérőszám. VR-ben viszont **két
összetevőre bomlik**, és ez a bontás a modul legérdekesebb hozadéka:

```
resumption_lag = reorientation_time + decision_time

reorientation_time   a megszakítás vége → az első pillanat, amikor a helyes
                     állomás a látómező közepe 30°-án belülre kerül
decision_time        az az első pillanat → a helyes kezelőszerv működtetése
```

Aki gyorsan fordul a helyes állomás felé, de sokáig áll ott, **emlékezeti**
helyreállási problémával küzd. Aki körbepásztáz, mielőtt megtalálja, a
**térbeli helyben-tartással**. A két profil különböző beavatkozást kíván, és
egyetlen `resumption_lag` szám összemossa őket.

Emellett mérhető a **hibás állomás felé fordulás**
(`wrong_station_visits`): hányszor fordult a helyestől eltérő állomás felé
30°-on belülre, mielőtt megtalálta a helyeset.

**Asztali gépen** ugyanez a mutató elvileg megvan a mutató mozgásából, de
**más mennyiség** (egy egérmozdulat nem testfordulás), ezért más a neve:
`pointer_reorientation_time`, és nem kerül egy normacsoportba a VR-értékkel.

**Mobilon nincs**: érintésnél nincs mozdulat a válasz előtt
(`02-CROSSPLATFORM-INTERACTION.md` 3.1), és minden állomás egyszerre
látszik. A `resumption_lag` mobilon **egészben** kerül mérésre, ami a
szakirodalmi mutató — csak nem bontható.

### 5.3. Platformonként kieső metrikák

| Metrika | vr | desktop | mobile |
|---|---|---|---|
| `reorientation_time` / `decision_time` | ✓ | — | — |
| `pointer_reorientation_time` | — | ✓ | — |
| `wrong_station_visits` | ✓ | — | — |
| `resumption_lag` | ✓ | ✓ | ✓ |
| minden egyéb | ✓ | ✓ | ✓ |

### 5.4. `controlHint`

| Platform | Szöveg |
|---|---|
| VR | `RAVASZ a kezelőszerven · fordulj az állomás felé` |
| asztali | `KATTINTÁS a kezelőszerven` |
| mobil | `KOPPINTS a kezelőszervre` |

---

## 5/B. MOBIL VEZÉRLŐKÉSZLET

| Blokk | `buttons` | `dial` | `slider` | `look` | `hint` |
|---|---|---|---|---|---|
| `learn` | — | — | — | `off` | „Kövesd a kivilágított kezelőszervet. Jegyezd meg a sorrendet.” |
| `baseline` | — | — | — | `off` | „Most magadtól, ugyanabban a sorrendben.” |
| `interrupted` | — | — | — | `off` | „Ha megszakítanak, utána folytasd onnan, ahol abbahagytad.” |
| `revised` (nyomás) | — | — | — | `off` | „Ugyanaz, de az idő fogy. Sorrend előbb, sebesség utána.” |
| `revised` (módosítás) | — | — | — | `off` | „A 6. lépés megváltozott.” |

**Három állítás.**

1. **Nincs vezérlősáv, csak `hint`.** A válasz maga a kezelőszerv, ami már
   koppintható panelelem. Egy gombsor itt **rontana**: elfoglalná a képernyő
   alját, ahol a mobil elrendezés alsó állomássora van, és a válasz
   kétértelművé válna (a sávgomb vagy a panel?).
2. **A `hint` nem foglal insetet.** A `MobileControls.reportInset` csak a
   ténylegesen érintést nyelő sávot számolja, tehát az alsó állomássor
   koppintható marad — pontosan az a hiba, amit a korábbi körben javítottunk.
3. **`look: 'off'`.** Mobilon minden állomás látszik, tehát nincs mit
   körbenézni; a modul emellett minden lépés idejét méri, és a húzás a
   `pointerup`-ig halasztaná a koppintást.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Mi teszi nehezebbé.** A lépésszám, a megszakítások száma és hossza, az
időnyomásos menet határideje, és az, hogy a módosítás az eljárás melyik
részét érinti (a közepe nehezebb, mint a széle).

### `PROTOCOL_STANDARD_A`

```
stations                  6
controlsPerStation        3
procedureSteps            10
guidedPasses              3
unguidedLearnPasses       1
baselineRuns              2
interruptedRuns           2
interruptionsPerRun       2
interruptionAfterSteps    4, 8   (± 1 lépés véletlen eltolás)
interruptionTrials        4
runTimeoutMs              90000
pressureTimeoutMs         38000
revisedStepIndex          6      (1-alapú)
changeNoticeMs            8000
stationAzDeg (vr)         0, 60, 120, 180, -120, -60
stationAzDeg (flat)       -26, 0, 26  ·  elevatio +10 / -10
facingThresholdDeg        30
```

A 38 s-os időnyomásos határidő a `baseline` menetek mediánideje köré van
tervezve: egy gyakorlott résztvevő 30–34 s alatt végez, tehát a határidő
**teljesíthető, de nem kényelmes**. A modul indulásakor ez becslés; az
első normaminta után a `pressureTimeoutMs` a saját `baseline` medián
1,15-szörösére állítandó, résztvevőnként. Ezt a `runs.summary` rögzíti,
hogy később visszamenőleg elemezhető legyen.

### CHALLENGE mód

**Nincs.** A `challengeMode` a manifesztben `false`. Egy élő pontszám az
eljárásrendi feladatot sebességversennyé tenné, ami pontosan az a
viselkedés, amit a modul mérni akar — de nem előidézni.

---

## 7. METRIKÁK

### 7.1. Nyers (lépésenként)

| Név | Egység |
|---|---|
| `step_index` | 1–10 |
| `expected_control`, `actual_control` | állomás:kezelőszerv |
| `step_time_ms` | ms — az előző helyes lépés óta |
| `outcome` | `correct` / `wrong_control` / `omitted` |
| `after_interruption` | 0/1 |
| `facing_station_at_start` | állomásazonosító (VR) |
| `reorientation_ms`, `decision_ms` | ms (VR) |

### 7.2. Származtatott

`omitted_steps` = az `omitted` állapotban maradt lépések száma az összes
mért menetben (a `learn` vezetett menetei nélkül).

`order_errors` = a `wrong_control` események száma, ahol a működtetett
kezelőszerv **az eljárás része**, de nem a soron következő. A nem
eljárásbeli kezelőszervek külön mutatóban (`off_procedure_actions`) —
a kettő különböző hiba: az egyik sorrendtévesztés, a másik teljes
elveszés.

`resumption_lag` = a megszakító panel eltűnése és az első **helyes**
eljárási lépés közti idő mediánja.

`post_interruption_error_rate` = a megszakítás utáni **első három** lépésben
elkövetett hibák aránya, mínusz ugyanez a nem megszakítás utáni lépéseken.
Pozitív érték = a megszakítás valóban rontott.

`compliance_under_pressure` = a helyes lépések aránya az időnyomásos
menetben, osztva a `baseline` menetek helyes arányával. 1,0 = a nyomás nem
rontott; 0,7 = harmadával több hiba.

`sequence_recall_accuracy` = a `learn` blokk önálló menetében helyesen és
sorrendhelyesen végrehajtott lépések aránya.

`perseveration_rate` = a módosított menetben a **régi** kezelőszerv
működtetéseinek száma osztva a menetek számával. 0 = azonnal átállt.

`step_time_median_ms` = a helyes lépések idejének mediánja a `baseline`
menetekben.

**VR-only.**
`reorientation_time` = a megszakítás vége és az az első pillanat közti idő,
amikor a helyes állomás a nézésirány 30°-án belülre kerül — mediánban.
`decision_time` = `resumption_lag − reorientation_time`, mediánban.
`wrong_station_visits` = hány idegen állomás felé fordult 30°-on belülre a
helyes megtalálása előtt, megszakításonként.

### 7.3. Score (0–100) és horgonyok

| Score | Metrika | `good` | `poor` | Indoklás |
|---|---|---|---|---|
| `procedural_accuracy` | `1 − (omitted + order_errors) / lépések` | 0,97 | 0,72 | egy 10 lépéses eljárásban 6 menet = 60 lépés; 0,97 ≈ 2 hiba, 0,72 ≈ 17 |
| `interruption_recovery` | `resumption_lag` | 1,8 s | 8,0 s | Trafton nagyságrendje egy hasonló komplexitású feladatra; **becslés** |
| `pressure_compliance` | `compliance_under_pressure` | 1,00 | 0,65 | 1,0 fölött nincs bónusz: a nyomás alatti *jobb* teljesítmény gyakorlás, nem fegyelem |
| `sequence_retention` | `sequence_recall_accuracy` | 0,95 | 0,50 | három vezetett menet után 0,5 alatt az eljárás nem rögzült |
| `change_adaptation` | `perseveration_rate` | 0 | 2,0 | 2 menetből 2 perszeveráció = a régi szokás nem írható felül |
| `spatial_place_keeping` | `reorientation_time` | 0,9 s | 4,5 s | **VR-only**; 0,9 s egy célzott fordulás, 4,5 s már keresés |

### 7.4. OPS SCORE összetevők

| Összetevő | Súly (VR) | Súly (sík) |
|---|---|---|
| `procedural_accuracy` | 0,26 | 0,28 |
| `interruption_recovery` | 0,22 | 0,25 |
| `pressure_compliance` | 0,16 | 0,18 |
| `sequence_retention` | 0,14 | 0,16 |
| `change_adaptation` | 0,12 | 0,13 |
| `spatial_place_keeping` | 0,10 | — |
| **Összeg** | **1,00** | **1,00** |

**Tengelypontszámok:** `executive` = procedural_accuracy, interruption_recovery
és change_adaptation átlaga; `memory` = sequence_retention.

---

## 8. ESEMÉNYNAPLÓ

| Eseménytípus | Payload |
|---|---|
| `protocol_setup` | `platform`, `layout`, `stationAzDeg`, `procedure[]`, `controlTypes`, `revisedStepIndex`, `revisedControl`, `interruptionAfter[]`, `quantisationMs` |
| `run_start` | `blockId`, `runIndex`, `guided`, `pressure`, `revised`, `timeoutMs` |
| `step` | `stepIndex`, `expected`, `actual`, `outcome`, `stepTimeMs`, `afterInterruption`, `facingStation`, `headOffsetDeg` |
| `omission` | `stepIndex`, `skippedTo` |
| `off_procedure_action` | `control`, `stepIndex` |
| `interruption_start` / `interruption_end` | `runIndex`, `afterStep`, `panelStation`, `trials`, `durationMs` |
| `interruption_response` | `trial`, `correct`, `rtMs` |
| `resumption` | `runIndex`, `lagMs`, `reorientationMs`, `decisionMs`, `wrongStationVisits`, `resumedAtStep`, `correctResumption` |
| `change_notice` | `stepIndex`, `oldControl`, `newControl`, `shownMs` |
| `perseveration` | `stepIndex`, `usedControl` |
| `run_end` | `blockId`, `runIndex`, `durationMs`, `correct`, `omitted`, `orderErrors`, `completed` |
| `station_gaze` | `station`, `previous`, `offsetDeg` — **csak VR** |

**Mozgásnaplózás: 20 Hz.** A fejirány valódi metrika (a helyreállás
bontása), és a 20 Hz elég a 0,5–2 s-os fordulások szegmentálásához.

**A `resumption` esemény tartalmazza a `resumedAtStep` mezőt**, tehát utólag
elemezhető, hogy a résztvevő a helyes lépésnél folytatta-e, egyet
visszalépett, vagy egyet átugrott — ez a prospektív memória irodalmában
külön hibatípus, és ma nincs a pontozásban, de a naplóból később
kiszámolható.

---

## 9. ADATBÁZIS

Nincs új tábla. Egy `trials` sor = egy lépés:

```json
stimulus: { "blockId": "interrupted", "runIndex": 1, "stepIndex": 5,
            "expected": "s3:valve", "afterInterruption": true,
            "facingStation": 1, "headOffsetDeg": 118.2 }
response:  { "actual": "s3:valve", "stepTimeMs": 3420,
             "reorientationMs": 1180, "decisionMs": 2240 }
correct: true, outcome: "hit", reactionTimeMs: 3420
```

A kihagyott lépés `outcome: "miss"` és `response: null` értékkel kerül be,
a menet végén — nem a kihagyás pillanatában, mert akkor még nem tudjuk,
hogy kihagyás lett-e vagy csak késik.

---

## 10. FELHASZNÁLÓI FOLYAMAT

**INTRO.**
> **PROTOCOL — Eljárásrendi fegyelem**
> Megtanulsz egy tíz lépéses eljárást, aztán többször végrehajtod.
> Közben megszakítunk, sürgetünk, és egyszer meg is változtatjuk.
> Nem az a kérdés, meg tudod-e tanulni. Az, hogy hol veszíted el.
> **9 perc**

**INSTRUKCIÓ (blokkonként).**
> **TANULÁS.** Hat állomás vesz körül. Háromszor végigvezetlek az eljáráson:
> mindig a kivilágított kezelőszervet működtesd. Negyedszerre már magadtól.
>
> **ALAPVONAL.** Most kivilágítás nélkül, ugyanabban a sorrendben. Kétszer.
>
> **MEGSZAKÍTÁS.** Ugyanez, de közben kétszer félbeszakítalak egy rövid
> másik feladattal. Utána onnan folytasd, ahol abbahagytad.
>
> **VÁLTOZÁS.** Az utolsó két menetből az egyikben fogy az idő, a másik
> előtt megváltoztatom az eljárás egy lépését.

**KALIBRÁCIÓ.** A testhelyzet rögzítése (`BodyAnchor`), majd VR-ben:
> *Fordulj körbe egyszer. Hat állomás van, sorszámozva — jegyezd meg, hol vannak.*

**MÉRÉS.** `learn` → `baseline` → `interrupted` → `revised`.

**EREDMÉNY** (kiemelt sorok):

| Sor | Példaérték | Magyarázó |
|---|---|---|
| Eljáráshűség | **93%** | 60 lépésből 4 hiba |
| Kihagyott lépés | **2** | mindkettő megszakítás után |
| Helyreállás megszakítás után | **3,4 s** | ebből 1,2 s a visszatájékozódás — *a bontás csak VR* |
| Időnyomás alatt | **0,88** | nyomás alatt 12%-kal több hiba |
| Sorrend megőrzése | **90%** | három vezetett menet után |
| Változás átvétele | **1 perszeveráció** | egyszer még a régi lépést csináltad |

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Forrásparadigmák.** Az ellenőrzőlista-követés és a prospektív memória
irodalma, valamint a megszakítás utáni helyreállás kísérleti mérése
(resumption lag; Trafton, Altmann és mtsai). A megszakítás hossza (10–13 s)
és a helye (a feladat közepe táján) ebből a hagyományból származik: a
2 s-nál rövidebb megszakítás alig okoz költséget, a 30 s fölötti pedig
teljesen kitörli a helyben-tartást.

**Amiben eltérünk.**
1. **Körülvevő elrendezés.** A klasszikus kísérletek egy képernyőn futnak.
   A 360°-os elrendezés új mutatót tesz mérhetővé (a helyreállás bontása),
   de azt is jelenti, hogy a VR-ben mért `resumption_lag` **hosszabb**, mint
   a szakirodalmi értékek, mert tartalmazza a testfordulást. A sík változat
   értékei az összehasonlíthatóak.
2. **Absztrakt eljárás.** Szándékos: egy valósághű ellenőrzőlista a
   szakmai előismeretet mérné.
3. **A betanulás mérési szakasz.** Lásd 3.2.

**Elvárt nagyságrendek (becslés, kalibrálandó):**

| Metrika | Tartomány |
|---|---|
| `procedural_accuracy` | 0,80–0,98 |
| `resumption_lag` (VR) | 2,2–7,0 s |
| `resumption_lag` (sík) | 1,4–5,0 s |
| `reorientation_time` (VR) | 0,7–3,5 s |
| `compliance_under_pressure` | 0,70–1,00 |
| `sequence_recall_accuracy` | 0,55–1,00 |
| `perseveration_rate` | 0–2 |

**Amit ebből NEM szabad kikövetkeztetni.** Alkalmasságot bármely
munkakörre, lelkiismeretességet, vagy azt, hogy valaki a saját szakmai
eljárásait is így hajtaná végre — ott a tartalom ismerete és a rutin
egészen más helyzetet teremt.

**Tanulási hatás.** Az **eljárás** minden felvételnél új (a 10 lépés a
seedből generálódik), tehát a `sequence_recall_accuracy` ismételhető. A
**megszakítás mint jelenség** viszont megtanulható: a második felvételtől a
résztvevő számít rá, és a `resumption_lag` 15–30%-kal rövidül. Az
eredményképernyő az ismételt felvételnél ezt kiírja.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

| # | Állítás | Hogyan tesztelhető |
|---|---|---|
| 1 | A generált eljárás 10 lépés, és **két egymást követő lépés soha nincs ugyanazon az állomáson**. | 1000 generált eljárás ellenőrzése. |
| 2 | Két azonos seedű futás azonos eljárást, azonos megszakítási pontokat és azonos módosítást ad. | Két modul példány összehasonlítása. |
| 3 | Hibás kezelőszerv működtetése **nem lépteti** az eljárást: a várt lépés ugyanaz marad. | Szintetikus lépéssorozat; az `expected` változatlan. |
| 4 | Egy **későbbi** lépés kezelőszervének működtetése a köztes lépéseket `omitted`-re állítja, és onnan folytatja. | Szintetikus ugrás a 3.-ról a 6.-ra: 3 kihagyás, a következő várt lépés a 7. |
| 5 | Nem eljárásbeli kezelőszerv `off_procedure_action`, nem `order_error`. | Szintetikus érintés egy nem használt kezelőszerven. |
| 6 | A `resumption_lag` a megszakító panel **eltűnésétől** számol, nem a megszakítás kezdetétől. | Hamis órás menet ismert időpontokkal. |
| 7 | VR-ben `resumption_lag = reorientation_time + decision_time`, ±1 ms-on belül. | A három érték összevetése minden megszakításnál. |
| 8 | Sík platformon a `reorientation_time`, `decision_time` és `wrong_station_visits` **hiányzik**, nem nulla. | Asztali és mobil futás metrikalistája. |
| 9 | Mobilon a `pointer_reorientation_time` **sem** jelenik meg. | Mobil futás metrikalistája. |
| 10 | Sík platformon az öt OPS-súly összege 1,00, és `spatialWeightsApplied: false`. | Egységteszt mindkét súlylistára. |
| 11 | A `compliance_under_pressure` 1,0-nál nem ad többet: a nyomás alatti jobb teljesítmény nem jutalmazott. | Szintetikus futás 1,2-es aránnyal; a score azonos az 1,0-essel. |
| 12 | A `perseveration_rate` csak a módosított menetben számol, és csak a **régi** kezelőszervre. | Szintetikus menet régi és idegen kezelőszervvel. |
| 13 | A kihagyott lépés `outcome: "miss"` és `response: null` értékkel kerül a `trials` táblába. | A generált trial rekordok ellenőrzése. |
| 14 | Az időnyomásos menet 38 s után lezárul, és a hátralévő lépések kihagyásként rögzülnek. | Hamis órás menet válasz nélkül. |
| 15 | A `learn` blokk vezetett menetei **nem** kerülnek az `omitted_steps` és `order_errors` mutatóba. | Szintetikus futás hibás vezetett menettel. |
