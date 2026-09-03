# 23 — MODUL 15 · ADAPT

**Mozgástanulási ráta & vizuomotoros adaptáció**
`ADAPT_STANDARD_A` · egyetlen változat · VR elsődleges, sík platformon szűkített

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a modul nem azt méri, milyen jó valaki most, hanem azt,
**milyen gyorsan javul** — a kéz és a látott kurzor közé rejtett elforgatást
teszünk, és megfigyeljük, hány próba alatt kompenzálja, mennyi épült be belőle
tudattalanul, és mennyit őriz meg a második kitettségre.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Paradigma | Katalógus |
|---|---|---|---|
| Mozgástanulási ráta | Hány próba alatt éri el a hibajavítás a plató 63%-át | Vizuomotoros rotációs adaptáció | — |
| Vizuomotoros adaptáció | A mozgásterv átkalibrálása megváltozott vizuális visszacsatoláshoz | Prism / rotation adaptation | — |
| Utóhatás nagysága | A torzítás megszűnése utáni első próbák eltérése | Aftereffect | — |
| Újratanulási előny (savings) | Mennyivel gyorsabb a második adaptáció | Savings | — |
| Explicit/implicit arány | Az utóhatásban megjelenő (implicit) rész aránya a teljes adaptációhoz | Aftereffect-alapú dekompozíció | — |

### Amit kifejezetten NEM mér

- **Nem általános tanulási képesség.** A vizuomotoros adaptáció egy specifikus,
  cerebelláris hibaalapú tanulási folyamat. Nem jelzi előre a fogalmi tanulást,
  a nyelvtanulást vagy az iskolai teljesítményt.
- **Nem ügyesség.** Egy ügyetlen ember is adaptálhat gyorsan, és fordítva. A
  modul kifejezetten a **változás sebességét** méri, nem a szintet — ezért a
  kiindulási pontosság külön mutató, és nem keverjük a rátával.
- **Nem IQ, nem személyiség.**
- **Nem betaníthatósági garancia.** A gyors adaptáció egy munkakörben
  előnyt jelenthet, de a modul egyetlen feladatban mért ráta, nem alkalmassági
  ítélet.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** A tehetségazonosítás legnehezebb kérdése nem az,
ki a jobb most, hanem az, ki lesz jobb ugyanannyi edzésből. A tanulási ráta
ennek az egyetlen közvetlenül mérhető komponense, és a **pillanatnyi
teljesítménytől független** — épp ezért ad hozzá információt egy
kiválasztáshoz, ahol minden más mutató a jelen szintet méri.
*Példák: utánpótlás-szűrés, technikai sportágak, sportágváltás megalapozása.*

**B — Munka (elsődleges).** A legtöbb alkalmassági teszt a pillanatnyi szintet
méri; a betanítás költsége viszont a tanulási rátán múlik. Különösen releváns
ott, ahol a munkavégzés eleve **torzított vizuomotoros leképezésen** keresztül
zajlik: laparoszkópos műszer, távirányított gép, kamerán át vezérelt daru.
*Példák: laparoszkópos sebészet, távirányított gépkezelés, CNC-betanulás,
pályaorientációs tanácsadás.*

**A — Védelem (másodlagos).** Új fegyverrendszerre, új kezelőfelületre vagy
éjjellátó okozta perceptuális eltolódásra való átállás sebessége.
*Példák: rendszerváltás, új platformra átképzés.*

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Próba | Gyakorlás | Idő |
|---|---|---|---|---|
| 1 | `baseline` — ALAPVONAL | 32 | 8 | ~1,6 perc |
| 2 | `adaptation` — TANULÁS | 64 | 0 | ~3,2 perc |
| 3 | `probe` — PRÓBAPONTOK | 18 | 0 | ~0,9 perc |
| 4 | `washout` — VISSZAÁLLÁS | 24 | 0 | ~1,2 perc |
| 5 | `relearn` — ÚJRA | 32 | 0 | ~1,6 perc |

Teljes futás **9–11 perc**.

### 3.1. Az alapfeladat

A résztvevő egy kiindulási gömbből (`home`) egy célgömbhöz nyúl
karnyújtásnyira. **A kezét nem látja** — a kontrollermodell rejtve van —,
csak egy **kurzorgömböt**, ami a kéz helyét mutatja. A rotációs fázisokban a
kurzor a kéz helyzetének a függőleges tengely körül **30°-kal elforgatott**
képe, a kiindulási ponthoz viszonyítva.

```
PREPARE          a kéz visszatér a home gömbbe                várakozás
COUNTDOWN        a home felizzik                              350 ms
STIMULUS         megjelenik a célgömb                         —
RESPONSE WINDOW  a nyúlás; a kurzor a rotált kezet mutatja    max 2500 ms
RESPONSE         a kurzor eléri a célsugarat                  —
FEEDBACK         a kurzor 400 ms-ig a végponton marad
                 (a `probe` blokkban NINCS visszajelzés)      400 ms
INTER-TRIAL      visszatérés a home-ba                        400–700 ms
```

**A hibát a mozgás irányából mérjük, nem a végpontból.** Amikor a kéz eléri a
célsugár 60%-át, kiszámítjuk a mozgásirány és a célirány közti szöget. Ez a
standard mérés, mert a végpontba online korrekcióval is be lehet találni — a
korai irány viszont a **mozgásterv** állapotát mutatja, ami az adaptáció
tárgya.

### 3.2. A fázisok

| Blokk | Rotáció | Visszajelzés | Mit mér |
|---|---|---|---|
| `baseline` | 0° | van | kiindulási pontosság és szórás |
| `adaptation` | **+30°** | van | tanulási ráta, aszimptotikus hiba |
| `probe` | +30° | **nincs** | általánosítás irányra és **elevációra** |
| `washout` | 0° | van | **utóhatás** az első próbákon |
| `relearn` | **+30°** | van | savings |

A rotáció **bejelentés nélkül**, az `adaptation` blokk első próbájától
egyszerre kapcsol be (nem fokozatosan). Ez szándékos: a hirtelen bevezetés
nagyobb explicit komponenst hív elő, és a modul épp az explicit és az implicit
rész arányát akarja megbecsülni.

### 3.3. A `probe` blokk — a modul térbeli magja

18 visszajelzés nélküli próba, hat célpont-csoportban, csoportonként három:

| Csoport | Irány | Eleváció | Mit kérdez |
|---|---|---|---|
| `trained` | a betanított 8 irány közül | 0° | mennyi a teljes korrekció |
| `dir30` | ±30°-kal a betanítottól | 0° | irány szerinti általánosítás |
| `dir90` | ±90°-kal | 0° | messzi irány szerinti általánosítás |
| `elev_up` | betanított irány | **+30°** | **eleváció szerinti általánosítás** |
| `elev_down` | betanított irány | **−30°** | ugyanaz lefelé |
| `far` | betanított irány | 0°, nagyobb sugár | amplitúdó szerinti általánosítás |

**Az `elev_up` és `elev_down` csoport az, amiért ez a modul VR-ben van.**
A klasszikus rotációs adaptáció **egyetlen síkban** zajlik: képernyőn minden
cél ugyanabban a síkban van, tehát az „általánosít-e a mozgásterv a
síkon kívülre" kérdés fel sem tehető. Karnyújtásnyi térben viszont a
mozgásnak van elevációs komponense, és a betanított korrekció **nem
szükségszerűen** vihető át rá.

```
elevation_generalisation = korrekció(elev_up, elev_down) / korrekció(trained)
```

1,0 körüli érték: a tanulás a mozgásirányhoz kötődik, nem a síkhoz.
0 felé: a tanulás síkspecifikus, tehát szűkebb, mint amilyennek látszik.

---

## 4. INGERDEFINÍCIÓ

| Elem | Primitív | Méret | Szín |
|---|---|---|---|
| `home` gömb | gömb | 0,04 m | `textMuted`, felizzik `accent`-re |
| Célgömb | gömb | 0,05 m | `accent` |
| Kurzor | gömb | 0,025 m | `accent2` |
| Célsugár-gyűrű | tórusz | 2 × célsugár | `textMuted`, 0,18 opacitás |
| Kontrollermodell | — | **rejtve** | — |

A kontrollermodell elrejtése **nem kozmetikai**: ha a résztvevő látja a saját
kezét, nincs vizuomotoros konfliktus, és a modul nem mér semmit. Ez az egyetlen
modul, amely a bemeneti eszköz megjelenítését kikapcsolja.

Célsugár **0,55 m** (`far` csoportban 0,75 m), a `home` a testtől 0,25 m-re,
mellmagasságban. Nyolc betanított irány, 45°-onként, a vízszintes síkban.

### 4/B. TÉRBELISÉG — A MODUL LÉTJOGOSULTSÁGA

> **Mi változna, ha az egész jelenetet lelapítanám egyetlen gömbhéjra?**

A rotációs adaptáció klasszikusan **sík feladat**, és sík formájában is
érvényes — ezt a modul nem tagadja, sőt sík platformon pontosan azt futtatja.
A térbeliség két dolgot ad hozzá, amit a sík változat nem tud:

| Ami eltűnne | Miért |
|---|---|
| `elevation_generalisation` | egy síkon nincs elevációs cél |
| `movement_plane_deviation` | egy síkon a mozgás nem tud kilépni a síkból |
| a nyúlás mint valódi kartmozgás | egérrel a mozgás a csuklóé, nem a karé |

**Használt térbeli eszközök (a hatból három):**

| Eszköz | Az ebből származó mérőszám | Pontozásban |
|---|---|---|
| **Karnyújtásnyi tér** | `adaptation_rate_trials`, `aftereffect_deg` valódi karmozgásból; `movement_plane_deviation` | igen (a ráta 0,30) |
| **Rejtett transzformáció** | a kéz és a kurzor közti forgatás **láthatatlan**: a résztvevő csak a következményét látja | igen (az egész paradigma alapja) |
| **Mélység / eleváció** | `elevation_generalisation` | igen (0,12) |

**VR-only mutatók:** `elevation_generalisation`, `movement_plane_deviation`,
`far_generalisation`.

**A rejtett transzformáció szabálya teljesül:** a forgatás soha nem látható.
Ha a résztvevő látná a kezét is és a kurzort is, a feladat vizuális
összeillesztés lenne, nem adaptáció. Ezért van elrejtve a kontrollermodell,
és ezért nincs semmilyen jelzés a rotáció be- vagy kikapcsolásáról.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Feladatelem | VR | Desktop | Mobil | Besorolás |
|---|---|---|---|---|
| Nyúlás | valódi karmozgás, kontroller | egérmozgás | ujjhúzás | **`adapted`** |
| Kurzor | 3D gömb a kéz rotált helyén | 2D kurzor a rotált egérhelyen | ua. | `adapted` |
| Rotáció | 30° a függőleges tengely körül | 30° a képernyősíkban | ua. | `equivalent` |
| Célok | 8 irány, vízszintes síkban | 8 irány, képernyősíkban | ua. | `equivalent` |
| Elevációs próbapontok | ±30° | — | — | **`vr-only`** |
| `far` próbapont | 0,75 m | — | — | **`vr-only`** |
| Síkon kívüli eltérés | mérve | — | — | **`vr-only`** |

**A sík változat a szakirodalommal jobban összevethető**, mert a klasszikus
kísérletek is síkban zajlanak. A VR-változat viszont valódi karmozgást mér,
aminek más a motoros zaja. A `comparability` kulcs ezért itt is elválasztja az
eszközosztályokat, és az **abszolút ráták nem hasonlíthatók** VR és asztali
futás között — csak a rangsor az osztályon belül.

### Sík platformon kieső metrikák

`elevation_generalisation`, `movement_plane_deviation`, `far_generalisation`.
Hiányoznak, nem nullák; a `spatial_generalisation` súlya 0, a maradék négy
arányosan felskálázódik, és az eredményképernyő kiírja.

### `controlHint`

- **VR:** `Nyúlj a célhoz — a kezed nem látod, csak a pontot`
- **Desktop:** `EGÉR: mozgatás · a kurzor nem ott lesz, ahol az egér`
- **Mobil:** `HÚZD az ujjad a cél felé`

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Amitől nehezebb:** nagyobb rotációs szög, hirtelen (nem fokozatos)
bevezetés, visszajelzés nélküli próbák, rövidebb válaszablak.

| Paraméter | `ADAPT_STANDARD_A` | `ADAPT_SHORT` |
|---|---|---|
| Rotáció | 30° | 30° |
| `baseline` | 32 | 16 |
| `adaptation` | 64 | 40 |
| `probe` | 18 (6 × 3) | 9 (3 × 3) |
| `washout` | 24 | 16 |
| `relearn` | 32 | 24 |
| Becsült idő | 9–11 perc | 6 perc |

**A 64 próbás adaptációs fázis — és annak korlátja.** Szimulációval
ellenőrizve (200 futás, 64 próba) az illesztés **torzítatlan**: τ = 8-ra 8,0,
τ = 30-ra 30,2 az átlag. A futásonkénti **szórás** viszont teljesen a
megfigyelt időállandók számától (`n/τ`) függ:

| Igazi τ | `n/τ` | Becslés szórása | 95%-os tartomány |
|---|---|---|---|
| 8 | 8,0 | ±0,6 | [7, 9] |
| 14 | 4,6 | ±1,0 | [13, 17] |
| 20 | 3,2 | ±1,8 | [17, 24] |
| 30 | 2,1 | ±3,8 | [25, 38] |
| 40 | 1,6 | ±7,4 | [30, 59] |

Vagyis **64 próba a gyors és közepes tanulókra elegendő, a lassúakra nem** —
és épp a lassan tanulók azok, akiknél a mérés a legfontosabb volna. Ezt nem
lehet több próbával megoldani a modul időkeretén belül (τ = 40-hez ~160 próba
kellene, ami 8 perc önmagában), ezért a modul **kimondja a bizonytalanságot**
ahelyett, hogy elrejtené:

- az `adaptation_observed_time_constants` (`n/τ`) metrika mindig kikerül,
- ha ez **2,5 alatt** van, az eredményképernyő a rátát **alsó becslésként**
  írja ki („≥ 34 próba"), és megindokolja,
- a `summary.adaptation.rateNote` rögzíti, hogy a fázis a görbe beállása előtt
  ért véget.

**Az `r2` erre nem alkalmas jelzés**: egy másfél időállandónyit megfigyelt
görbe is kiválóan illeszkedik (r² > 0,9), miközben a τ-ja megbízhatatlan. A
két ellenőrzés — illesztési minőség és megfigyelési hossz — **külön kell**,
és a modul mindkettőt elvégzi.

**CHALLENGE mód: nincs.** A `challengeMode: false` szándékos: a tanulási ráta
nem javítható erőlködéssel, versenymódban viszont a résztvevő explicit
stratégiát keresne, ami épp azt a komponenst torzítja, amit a modul szét akar
választani.

---

## 7. METRIKÁK

### Nyers (próbánként)

`phase`, `trialInPhase`, `targetAzDeg`, `targetElDeg`, `targetRadiusM`,
`rotationDeg`, `feedback` (logikai), `directionErrorDeg` (a célsugár 60%-ánál),
`endpointErrorDeg`, `movementTimeMs`, `reactionTimeMs`, `pathPlaneDeviationM`.

### Származtatott

| Metrika | Definíció | Egység |
|---|---|---|
| `baseline_error_sd_deg` | az iránybeli hiba szórása az alapvonalon | fok |
| `adaptation_rate_trials` | az exponenciális illesztés időállandója (τ) az `adaptation` fázis iránybeli hibáira | próba |
| `adaptation_fit_r2` | az illesztés magyarázott varianciája | 0–1 |
| `adaptation_observed_time_constants` | `n / τ` — hány időállandónyit figyeltünk meg; 2,5 alatt a τ alsó becslés | arány |
| `asymptotic_error_deg` | az illesztett aszimptota | fok |
| `early_adaptation_deg` | az első 8 próba átlagos hibacsökkenése | fok |
| `aftereffect_deg` | a `washout` első **3** próbájának átlagos iránybeli hibája (a rotációval ellentétes irányban) | fok |
| `implicit_fraction` | `aftereffect_deg / (30 − asymptotic_error_deg)` — a teljes adaptációból mennyi épült be tudattalanul | arány |
| `savings_index` | `1 − (τ_relearn / τ_adaptation)` | arány |
| `direction_generalisation_30` / `_90` | a `dir30` és `dir90` próbapontok korrekciója a `trained` arányában | arány |
| `elevation_generalisation` | az `elev_up` és `elev_down` korrekciója a `trained` arányában | arány |
| `far_generalisation` | a `far` csoport korrekciója a `trained` arányában | arány |
| `movement_plane_deviation` | a nyúláspálya átlagos eltérése a `home`–cél síktól | m |

**Az `implicit_fraction` becslés, nem mérés.** Az explicit és implicit rész
pontos szétválasztásához célzási beszámoló („hova céloztál?") kellene minden
próbán. A modul ezt nem kéri, mert az önmagában megváltoztatja a stratégiát;
helyette az utóhatásból közelít, ami a szakirodalomban elfogadott, de
felfelé torzító közelítés. A specifikáció ezt kimondja, és az
eredményképernyő „becsült" jelzővel írja ki.

### Score-összetevők

| Összetevő | Képlet | `good` | `poor` | Súly (VR) | Súly (sík) |
|---|---|---|---|---|---|
| `learning_rate` | `adaptation_rate_trials` | 8 | 40 | 0,30 | 0,34 |
| `savings` | `savings_index` | 0,50 | 0,00 | 0,22 | 0,25 |
| `final_accuracy` | `asymptotic_error_deg` | 3° | 18° | 0,20 | 0,23 |
| `implicit_learning` | `implicit_fraction` | 0,65 | 0,15 | 0,16 | 0,18 |
| `spatial_generalisation` | `elevation_generalisation` | 0,85 | 0,25 | 0,12 | **0** |

VR: 0,30+0,22+0,20+0,16+0,12 = **1,00**. Sík: 0,34+0,25+0,23+0,18 = **1,00**.

**Két külön ellenőrzés van, és mindkettő kell.**

1. Ha az illesztés `r2` értéke **0,25 alatt** van, a résztvevő valószínűleg nem
   adaptált. A `learning_rate` összetevő ilyenkor **0 pontot kap**, nem a
   τ-ból számítottat — egy nem tanuló görbére illesztett τ értelmetlen szám.
2. Ha az `adaptation_observed_time_constants` **2,5 alatt** van, a τ magas r²
   mellett is megbízhatatlan. Ilyenkor a pontszám a legjobb becslést használja
   (ez a rendelkezésre álló legjobb információ), de az eredményképernyő
   **alsó becslésként** közli, és megindokolja.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `adapt_setup` | `platform`, `rotationDeg`, `targetRadiusM`, `directions`, `phasePlan` |
| `phase_start` | `phase`, `rotationDeg`, `feedback`, `trials` |
| `target_on` | `phase`, `trialInPhase`, `azDeg`, `elDeg`, `radiusM`, `group?` |
| `movement_start` | `reactionTimeMs`, `handPos` |
| `direction_sample` | `atFractionOfRadius`, `directionErrorDeg`, `tMs` |
| `reach_end` | `endpointErrorDeg`, `movementTimeMs`, `planeDeviationM`, `feedbackShown` |
| `rotation_change` | `fromDeg`, `toDeg`, `atTrial` |
| `phase_summary` | `phase`, `meanErrorDeg`, `n`, `tau?`, `r2?` |

**Motion logging: 30 Hz.** A nyúláspálya alakja itt valódi adat — a
`movement_plane_deviation` és a késői online korrekció ebből számítható. 30 Hz
egy 400–700 ms-os nyúlásra 12–21 mintát ad, ami a pálya alakjához elég, és
lényegesen kevesebb, mint amit a STEADY igényel.

---

## 9. ADATBÁZIS

Nincs új tábla.

`trials.stimulus`: `{ phase, trialInPhase, group?, azDeg, elDeg, radiusM, rotationDeg, feedback, platform }`
`trials.response`: `{ directionErrorDeg, endpointErrorDeg, movementTimeMs, reactionTimeMs, planeDeviationM }`
`outcome`: `hit` (a kurzor a célsugáron belülre ért) · `miss` (kiért, de nagy hibával) ·
`timeout` (2500 ms alatt nem érte el a célsugarat) · `invalid` (nem indult el a home-ból).

---

## 10. FELHASZNÁLÓI FOLYAMAT

**Intro.** „ADAPT — Tanulási ráta. Ez a teszt nem azt méri, milyen jó vagy,
hanem azt, milyen gyorsan tanulsz. Egyszerű nyúlásokkal."

**Instrukció (`baseline`).** „Egy pontot fogsz látni a kezed helyén — **a
kezedet magát nem látod**. Vidd a pontot a célgömbhöz, egy gyors, egyenes
mozdulattal. Ne javítgasd útközben: **célozz, és mozdulj**."

**Kalibráció.** 8 gyakorlóprób a visszajelzéssel. „Most gyakorolunk. Így néz
ki, amikor minden rendben van."

**A rotáció bevezetése: nincs instrukció.** Az `adaptation` blokk ugyanazzal a
szöveggel indul, mint az alapvonal: „Folytasd ugyanígy." A résztvevő azt fogja
tapasztalni, hogy elvéti a célt, és magától korrigál. **Ez a mérés lényege**,
és bármilyen figyelmeztetés elrontaná.

**A `probe` blokk előtt.** „A következő pár próbában nem fogod látni, hova ért
a pont. Csak célozz úgy, ahogy eddig."

**A `washout` előtt: szintén nincs instrukció.**

**Eredményképernyő (6 sor).**

| Sor | Példaérték |
|---|---|
| Tanulási ráta | `14 próba` — *ennyi alatt tetted meg a javulás 63%-át* |
| Végső pontosság | `5,2°` — *ennyi hiba maradt* |
| Utóhatás | `11,4°` — *ennyi épült be tudattalanul* |
| Beépült arány | `~48%` — *becsült implicit rész* |
| Újratanulás | `+38%` — *ennyivel gyorsabb volt másodszorra* |
| Térbeli átvitel | `0,72` — *más magasságban ennyire működött* |

Ha az illesztés `r2 < 0,25`: az első sor helyére
**„A görbe nem illeszthető — valószínűleg nem adaptáltál. A ráta nem
értelmezhető."** kerül.

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A vizuomotoros rotációs adaptáció standard négyfázisú
elrendezése (alapvonal → adaptáció → washout → újratanulás); az utóhatás mint
az implicit komponens mértéke; a savings mint a megőrzött tanulás mutatója; az
általánosítási függvény felvétele visszajelzés nélküli próbapontokkal.

**Eltérés.** (1) A klasszikus kísérlet síkban, digitalizáló táblán vagy
képernyőn zajlik; itt karnyújtásnyi 3D térben, ami nagyobb motoros zajt és
valamivel lassabb adaptációt ad. (2) Az elevációs próbapontok a szakirodalomban
nem szerepelnek — ez a paradigma **kiterjesztése**, kalibrálatlan. (3) Az
explicit/implicit szétválasztás célzási beszámoló helyett utóhatásból becsült.

**Elvárt nagyságrend** egészséges felnőttnél (becslés): `adaptation_rate_trials`
10–28 próba, `asymptotic_error_deg` 3–12°, `aftereffect_deg` 8–18°,
`implicit_fraction` 0,35–0,70, `savings_index` 0,15–0,55,
`elevation_generalisation` 0,55–0,95.

**Amit nem szabad kikövetkeztetni.** Általános tanulékonyságot; alkalmasságot;
sportági vagy szakmai potenciált egyetlen felvételből. A ráta egyénen belül is
feladatspecifikus.

**Tanulási hatás — és ez a modul legsúlyosabb korlátja.** A savings
**definíció szerint** azt jelenti, hogy a második kitettség gyorsabb. Ezért
**az ADAPT ismételt felvétele nem ad új alapvonalat**: aki egyszer már
adaptált 30°-ra, az másodszorra sokkal gyorsabban fog. A modul
**egyszer felvehető** mérőeszköz, és ismételt felvételnél:
- a `savings_index` értelmezhetetlenné válik,
- az `adaptation_rate_trials` felfelé torzul (gyorsabbnak látszik),
- **ellentétes forgásirányt kell használni** (−30°), ami részben,
  de nem teljesen semlegesíti a hatást.

Ezt az eredményképernyő és a profil is jelzi: ismételt felvételnél a modul
figyelmeztet, hogy az érték nem hasonlítható az elsőhöz.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. **A kontrollermodell a teljes futás alatt rejtve van.** *Teszt: a
   `visible` állapot minden fázisban hamis.*
2. **A rotáció a `home` ponthoz képest, a függőleges tengely körül forgat.**
   *Teszt: egy ismert kézpozícióra a kurzor helye analitikusan ellenőrizhető.*
3. **A hiba a célsugár 60%-ánál mért mozgásirányból számítódik**, nem a
   végpontból. *Teszt: egy olyan szintetikus pálya, amely rosszul indul és
   online korrigál, nagy `directionErrorDeg`-et és kicsi `endpointErrorDeg`-et
   ad.*
4. **Egy ismert τ-jú szintetikus tanulási görbére a modul 25%-on belül
   visszaadja a τ-t.** *Teszt: `tests/psychophysics.test.ts`.*
5. **Egy nem adaptáló résztvevőre az illesztés `r2 < 0,25`, és a
   `learning_rate` összetevő 0 pontot kap**, nem a τ-ból számítottat.
   *Teszt: `tests/sport-modules.test.ts`.*
5/b. **Egy lassú tanulónál (`n/τ < 2,5`) a ráta alsó becslésként jelenik meg**,
   akkor is, ha az `r2` magas. *Teszt: ugyanott — τ = 30 és τ = 8 mellett is
   r² > 0,9, de csak az előbbi kap „≥" jelölést.*
6. **Az utóhatás a `washout` első 3 próbájából számítódik**, és előjele a
   rotációval ellentétes. *Teszt: szintetikus washout-sorozat.*
7. **A `probe` blokkban egyetlen próbán sincs visszajelzés.** *Teszt: a
   `feedbackShown` mező minden `probe` sorban hamis.*
8. **Sík platformon az `elevation_generalisation`, a
   `movement_plane_deviation` és a `far_generalisation` hiányzik**, nem nulla,
   és a súlyok 1,00-ra skálázódnak. *Teszt: a metrikalista és a súlyösszeg.*
9. **A rotáció bevezetését semmilyen vizuális vagy hangjelzés nem kíséri.**
   *Teszt: az eseménynapló nem tartalmaz felhasználónak szóló jelzést a
   `rotation_change` körül.*
10. **Két azonos seedű futás azonos célsorrendet és próbapont-sorrendet ad.**
    *Teszt: két `Rng(42)` futás.*
11. **Egy `ADAPT_SHORT` futás 7 percnél nem tart tovább.** *Teszt: a
    próbaszámok és a fázisidők összege.*
12. **Ismételt felvételnél a modul figyelmeztet**, hogy a savings és a ráta nem
    hasonlítható az első felvételhez. *Teszt: a profilból ismert korábbi futás
    esetén az eredményképernyő tartalmazza a figyelmeztetést.*
