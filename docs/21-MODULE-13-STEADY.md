# 21 — MODUL 13 · STEADY

**Poszturális stabilitás & kéznyugalom**
`STEADY_STANDARD_A` · egyetlen változat · **csak VR** (`supports: ['vr']`)

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a modul a headset és a kontrollerek 6DoF pozíciójából méri a
testlengést négy állási feltételben és a kéztremort karnyújtva, külön műszer
nélkül.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Paradigma | Katalógus |
|---|---|---|---|
| Poszturális stabilitás | A tömegközéppont vízszintes elmozdulásának mértéke álló helyzetben | Statikus poszturográfia | — |
| Egyensúly | A stabilitás megtartása csökkentett szenzoros bemenet mellett | Romberg-próba | 95 |
| Vizuális függés | Mennyire vezérli a látvány a testtartást, amikor a látvány hazudik | Mozgó szoba (Lee & Aronson) | — |
| Kéznyugalom / tremor | A kéz nagyfrekvenciás ingadozása célon tartás közben | Hand steadiness / tremorometria | — |
| Szenzomotoros integráció | A vizuális, vesztibuláris és propriocepciós bemenet súlyozásának átrendezése | Sensory reweighting | 40 |

### Amit kifejezetten NEM mér

- **Nem erőplató.** A valódi poszturográfia a talpnyomás középpontját (COP)
  méri; itt a **fej** vízszintes elmozdulását mérjük. A kettő korrelál, de nem
  azonos: a fej a lengés felerősített, késleltetett képe. Az abszolút
  értékek ezért **nem vethetők össze erőplatós normákkal**, csak a rendszeren
  belüli más felvételekkel.
- **Nem vesztibuláris diagnosztika.** A Romberg-hányados eltérése sokféle okból
  adódhat; a modul nem különbözteti meg őket.
- **Nem agyrázkódás-teszt.** Objektív alapvonalat és követést ad egy
  visszatérési protokollhoz, de a döntést nem hozza meg, és önmagában nem
  alkalmas a diagnózisra vagy a felmentésre.
- **Nem neurológiai tremor-diagnózis.** A domináns frekvencia leolvasható, de a
  fiziológiás és a patológiás tremor elkülönítése klinikai feladat.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** Az egyensúly-domináns sportágakban a statikus és a
perturbált stabilitás közvetlen teljesítménykorlát. A legfontosabb alkalmazás
viszont a **fejsérülés utáni visszatérési protokoll**: a poszturális kontroll
az agyrázkódás egyik legérzékenyebb, legtovább fennmaradó objektív jele, és a
protokollok ma jellemzően szemre értékelt egyensúlypróbákra támaszkodnak. Egy
mm-es felbontású, ismételhető alapvonal ehhez képest lényeges javulás.
*Példák: torna, sílesiklás, szörf, íjászat, agyrázkódás utáni return-to-play.*

**B — Munka (elsődleges).** A kéznyugalom objektív mérése eddig külön eszközt
igényelt. Magasban végzett munkánál a perturbált egyensúly, finommunkánál a
tremor amplitúdója és domináns frekvenciája a releváns mutató.
*Példák: sebész, fogorvos, állványozó, mikroszerelő, laboráns.*

**A — Védelem (másodlagos).** Lövészstabilitás és terhelt menet utáni egyensúly.
Másodlagos, mert a védelmi kiválasztásban ez jellemzően terhelés utáni
összehasonlításként értelmes (előtte-utána), nem önálló szűrőként.
*Példák: lövész, ejtőernyős, visszatérési szűrés.*

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Hossz | Gyakorlás | Cél |
|---|---|---|---|---|
| 1 | `stance` — NYITOTT SZEM | 30 s | 8 s | alapvonal |
| 2 | `dark` — ELSÖTÉTÍTVE | 30 s | 0 | a látvány elvétele (Romberg) |
| 3 | `sway` — MOZGÓ TÉR | 45 s | 8 s | vizuális függés mérése |
| 4 | `oneleg` — EGY LÁBON | 2 × 20 s | 0 | **opcionális, biztonsági kapuval** |
| 5 | `hand` — CÉLON TARTÁS | 2 × 30 s | 10 s | kéztremor |

Teljes futás **5–6 perc**, az `oneleg` blokk kihagyásával **4–5 perc**.

Ez a modul **nem próbaalapú**: folyamatos jelet rögzít. A `BlockDescriptor.trials`
mezője ezért kondíciószámot jelent (`hand`: 2 kéz, `oneleg`: 2 láb), nem
próbaszámot, és a haladásjelző ennek megfelelően viselkedik.

### 3.1. A blokkok anatómiája

```
PREPARE          „Állj kényelmesen, lábak vállszélességben"     kész-gombra vár
COUNTDOWN        3 · 2 · 1                                       3000 ms
STIMULUS         a mérési ablak; a jel folyamatosan rögzül       blokkhossz
                 (az első 3 s eldobásra kerül: a beállás
                  nem a lengés)
RESPONSE WINDOW  — (nincs válasz; a viselkedés maga a jel)
FEEDBACK         csak a gyakorlásban: élő lengésmutató
INTER-TRIAL      15 s szünet a blokkok között, leülhet
```

**Az első 3 másodperc eldobása** nem kozmetika: a mérés kezdetén a résztvevő
még helyezkedik, és ez a szakasz nagyságrendekkel nagyobb elmozdulást ad, mint
a nyugalmi lengés. Benne hagyva minden mutató a beállás sebességét mérné.

### 3.2. `dark` — az „elsötétített kijelző"

A csukott szem VR-ben nem ellenőrizhető. Helyette a **kijelzőt sötétítjük el**:
a jelenet teljesen fekete lesz, egyetlen halvány talajjelzés nélkül. Ez
**perceptuálisan nem azonos** a csukott szemmel (a szemhéj mögötti sötétség és
egy fekete kijelző eltérő ingerállapot), de a vizuális helyzetinformáció
elvétele szempontjából egyenértékű, és **ellenőrizhető** — ami a csukott szemnél
nem igaz. A specifikáció ezt kimondja, mert a Romberg-hányados értelmezése ezen
múlik.

Biztonsági szabály: a sötétítés előtt hangjelzés és 3 másodperces visszaszámlálás
figyelmeztet, és a blokk bármikor megszakítható a menügombbal.

### 3.3. `sway` — a mozgó tér

A résztvevőt egy pontrács veszi körül (360°, 2,5–6,0 m). A rács **egészben,
lassan előre-hátra mozog** 0,20 Hz-en, ±0,06 m amplitúdóval — ez a Lee és
Aronson „mozgó szoba" kísérletének VR-megfelelője. A rács mozgása optikai
áramlást kelt, amit a poszturális rendszer önmozgásként értelmez, és a
résztvevő **utánadől**, jellemzően anélkül, hogy tudna róla.

A mozgás **három szakaszban** zajlik:
1. 0–15 s: álló rács (alapvonal ugyanebben a jelenetben)
2. 15–35 s: 0,20 Hz-es oszcilláció
3. 35–45 s: álló rács (utóhatás)

**A frekvencia azért fix és ismert, mert ez teszi a mérést egyértelművé.**
A lengésjel teljesítményét pontosan 0,20 Hz-en olvassuk ki (Goertzel), és a
szomszédos frekvenciák (0,10 és 0,35 Hz) teljesítményéhez viszonyítjuk. Ha a
résztvevő nem követi a rácsot, 0,20 Hz-en nincs kiemelkedés. Ez sokkal
erősebb bizonyíték, mint a lengésamplitúdó puszta növekedése, amit fáradás is
okozhat.

### 3.4. `oneleg` — biztonsági kapu

Egy lábon állás headsetben **eleséskockázat**. A blokk ezért:

1. **Külön megerősítést kér**: „Van körülötted legalább 1,5 m szabad hely, és
   van valaki a közelben? Ha nincs, hagyd ki ezt a részt — a többi eredmény
   enélkül is érvényes."
2. **Kihagyható** egy egyenrangú, nem elrejtett gombbal (`KIHAGYOM`).
3. **Nem sötétít el semmit** és nem mozgatja a teret — csak a talajjelzés
   marad, ami vizuális horgonyt ad.
4. **20 s után magától véget ér**, és a résztvevő bármikor letehe­ti a lábát:
   a letételt (a fej hirtelen függőleges elmozdulását) `foot_down` eseményként
   naplózzuk, és a mérés a letételig tartó szakaszra korlátozódik.

Ha a blokk kimarad, a `single_leg_area_ratio` **hiányzik** (nem nulla), és a
pontozásból a súlya kiesik, a többi átskálázódik. Ezt az eredményképernyő kiírja.

### 3.5. `hand` — célon tartás

A résztvevő karnyújtva egy 0,03 m átmérőjű gömböt tart a kontroller hegyével
egy 0,05 m-es gyűrű közepén, 30 másodpercig, kezenként. A gyűrű
**karnyújtásnyira, 0,55 m-re** van, tehát a feladat peripersonalis térben zajlik.

A kéz pozíciójából két különböző dolgot olvasunk ki:
- **tremor**: a 6–14 Hz-es sáv RMS amplitúdója és domináns frekvenciája
- **drift**: a 0,5 Hz alatti lassú elmozdulás — ez fáradás vagy figyelemvesztés,
  nem tremor, és külön mutató

---

## 4. INGERDEFINÍCIÓ

| Elem | Primitív | Méret | Szín |
|---|---|---|---|
| Talajjelzés | gyűrű | 0,60 m átmérő, a padlón | `accent`, 0,4 opacitás |
| Pontrács (mozgó tér) | 96 gömb | 0,05 m, 2,5–6,0 m-en | `textMuted` |
| Célgyűrű (kéz) | tórusz | 0,05 m, 0,55 m-en | `accent` |
| Kézjelző | gömb | 0,03 m | `accent2` |
| Élő lengésmutató (gyakorlás) | sík panel | 0,4 × 0,4 m | — |

A pontrács szemcséi **azonos szögméretűek**: a 6,0 m-es gömb fizikai átmérője
2,4-szerese a 2,5 m-esének. E nélkül a rács mélységi szerkezete méretjelzésből
is kiolvasható lenne, és a mozgása nem tiszta optikai áramlást adna.

### 4/B. TÉRBELISÉG — A MODUL LÉTJOGOSULTSÁGA

> **Mi változna, ha az egész jelenetet lelapítanám egyetlen gömbhéjra?**

Ez a modul a legszélsőségesebb eset a katalógusban: **a mérőműszer maga a
térbeli követés**. A mért jel a fej és a kéz helye a szobában, milliméteres
felbontással. Lapítás után nincs mit mérni — nem egy metrika veszne el, hanem
mind.

| Ami eltűnne | Miért |
|---|---|
| minden lengésmutató | a jel a fej 3D pozíciója |
| `visual_reliance_gain` | a mozgó tér körülvevő optikai áramlás; egy héjon nincs áramlás |
| `tremor_rms_mm`, `tremor_peak_freq_hz` | a jel a kéz 3D pozíciója karnyújtásnyira |

**Használt térbeli eszközök (a hatból három):**

| Eszköz | Az ebből származó mérőszám | Pontozásban |
|---|---|---|
| **Körülvevő elrendezés** | `visual_reliance_gain`, `perturbation_gain_ratio` | igen (0,22) |
| **Karnyújtásnyi tér** | `tremor_rms_mm`, `tremor_peak_freq_hz`, `hand_drift_mm` | igen (0,26) |
| **Mélység önálló csatornaként** | a rács mélységi kiterjedése adja az optikai áramlást; szögméret-kompenzált | közvetve |

**VR-only mutatók: mind.** A modul `supports: ['vr']`, ezért a becsületességi
szabály itt triviálisan teljesül: a modul sík platformon **el sem indul**, a
kártyán letiltva és megindokolva jelenik meg. Nem adunk csökkentett változatot,
mert nincs olyan része, ami sík eszközön értelmes volna.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

Nincs. `supports: ['vr']`.

A modulkártyán a gomb letiltott, a magyarázat: „VR headsetet igényel — a mérés
a fej és a kéz térbeli helyzete."

`controlHint` (csak VR): `RAVASZ: indítás · MENÜ: megszakítás`

**Eszközfüggés.** Az abszolút értékek headsetenként eltérhetnek (követési zaj,
tömegeloszlás, pántfeszesség). A `comparability` kulcs ezért
`vr:quest3:controller`, és eltérő headseten készült felvételek **nem kerülnek
egy normacsoportba**. Ugyanannál a személynél az ismételt mérés csak azonos
eszközön értelmezhető — a return-to-play alkalmazásban ez kifejezetten fontos.

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Amitől nehezebb:** a vizuális információ elvétele, a támaszfelület szűkítése
(egy láb), a mozgó tér perturbációja, a mérés hossza.

| Paraméter | `STEADY_STANDARD_A` | `STEADY_SHORT` |
|---|---|---|
| `stance` | 30 s | 20 s |
| `dark` | 30 s | 20 s |
| `sway` | 45 s (15/20/10) | 30 s (10/14/6) |
| `oneleg` | 2 × 20 s | 1 × 20 s |
| `hand` | 2 × 30 s | 2 × 20 s |
| Perturbáció | 0,20 Hz, ±0,06 m | ugyanaz |
| Becsült idő | 5–6 perc | 3,5 perc |

**CHALLENGE mód: nincs.** Egy egyensúlyméréshez versenymód veszélyes
ösztönzőt adna (a résztvevő túlvállalna egy eleséskockázatos helyzetben), és
a mért mennyiség nem is javítható erőlködéssel. A manifeszt
`challengeMode: false`.

---

## 7. METRIKÁK

### Nyers (mintánként)

A fej és mindkét kontroller pozíciója a képfrissítés ütemében (Quest 3-on
72–90 Hz), blokkcímkével és a blokkon belüli időbélyeggel.

**A modul nem az `input.pose()` csatornán mintavételez.** Az a hívás
milliméterre kerekít (`Math.round(n * 1000) / 1000`), a kéztremor amplitúdója
viszont 0,3–1,2 mm — a mért érték túlnyomórészt kerekítési zaj lenne. A
pozíciókat ezért közvetlenül a jelenetgráfból olvassuk ki, teljes lebegőpontos
pontossággal. Ez a modul egyik nem magától értetődő, de nélkülözhetetlen
tervezési döntése.

### Származtatott

| Metrika | Definíció | Egység |
|---|---|---|
| `sway_path_length_mm` | a fej vízszintes útvonalának hossza a `stance` blokkban, az első 3 s nélkül | mm |
| `sway_area_95_mm2` | a 95%-os konfidencia-ellipszis területe (a kovarianciamátrix sajátértékeiből, 5,991-es szorzóval) | mm² |
| `sway_velocity_mm_s` | útvonalhossz / mérési idő | mm/s |
| `sway_ml_sd_mm` / `sway_ap_sd_mm` | oldalirányú és előre-hátra szórás | mm |
| `dark_area_95_mm2` | ugyanaz elsötétített kijelzővel | mm² |
| `romberg_quotient` | `dark_area_95_mm2 / sway_area_95_mm2` | arány |
| `perturbation_gain_ratio` | a lengés 95%-os ellipszise a mozgó és az álló szakaszban | arány |
| `visual_reliance_mm` | a lengés **amplitúdója** pontosan 0,20 Hz-en, milliméterben (Goertzel) | mm |
| `drive_frequency_concentration` | a 0,20 Hz-es teljesítmény aránya a {0,10 · 0,20 · 0,35 Hz} sáv teljesítményéhez, 0–1 | arány |
| `single_leg_area_ratio` | egy lábon / két lábon mért ellipszisterület | arány |
| `single_leg_duration_s` | meddig maradt fenn (max 20 s) | s |
| `tremor_rms_mm` | a kéz pozíciójának RMS amplitúdója a 6–14 Hz-es sávban | mm |
| `tremor_peak_freq_hz` | a domináns frekvencia ugyanebben a sávban | Hz |
| `hand_drift_mm` | a céltól mért átlagos távolság 0,5 Hz alatti komponense | mm |
| `hand_asymmetry` | a két kéz `tremor_rms_mm` értékének hányadosa (nagyobb / kisebb) | arány |

**A mozgó tér blokk két számot ad, mert két különböző kérdésre felel.**

A `visual_reliance_mm` azt mondja meg, **mennyit** lengett a résztvevő a tér
ütemére — milliméterben, tehát olvashatóan és személyek között
összehasonlíthatóan. (A szoba ±60 mm-t mozog, így egy 10 mm-es érték nagyjából
17%-os követést jelent.)

A `drive_frequency_concentration` azt mondja meg, hogy ez a lengés **specifikus
volt-e** a hajtófrekvenciára. Ez választja el a tér követését attól, hogy valaki
egyszerűen többet mozgott — az utóbbit a fáradás is előidézi, és az mindhárom
vizsgált frekvencián egyszerre emeli a teljesítményt.

**Miért nem teljesítményhányados.** Az első megvalósítás a 0,20 Hz-es
teljesítményt osztotta a szomszédos frekvenciákéval. Ez matematikailag
diszkriminál, de **nem korlátos**: tiszta jelen ezresekbe fut (a szimulációban
3134-et adott), eredményképernyőre alkalmatlan, és a pontozási horgonyokat
telíti. Az amplitúdó fizikailag korlátos, a koncentráció pedig konstrukció
szerint 0 és 1 közötti.

### Score-összetevők

| Összetevő | Képlet | `good` | `poor` | Súly |
|---|---|---|---|---|
| `hand_steadiness` | `tremor_rms_mm` | 0,25 mm | 2,2 mm | 0,26 |
| `static_stability` | `sway_area_95_mm2` | 220 mm² | 1900 mm² | 0,24 |
| `visual_independence` | `visual_reliance_mm` | 1,5 mm | 12 mm | 0,22 |
| `sensory_reweighting` | `romberg_quotient` | 1,3 | 3,2 | 0,16 |
| `single_leg_balance` | `single_leg_area_ratio` | 2,0 | 9,0 | 0,12 |

Összeg: **1,00**. Ha az `oneleg` blokk kimarad, a `single_leg_balance` súlya 0,
a maradék négy arányosan felskálázódik (0,295 / 0,273 / 0,250 / 0,182).

**A horgonyértékek becslések.** Fejkövetésre alapozott poszturográfiára nincs
közölt normatábla, és a fej lengése rendszeresen nagyobb a COP lengésénél.
Az értékek ezért a rendszeren belüli rangsorolásra használhatók; abszolút
minősítésre nem, amíg legalább 200 felvétel nem áll rendelkezésre. Ezt az
eredményképernyő is kiírja az első kiadásban.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `steady_setup` | `platform`, `blockLengthsS`, `perturbationHz`, `perturbationAmplitudeM`, `sampleHz` |
| `block_start` | `block`, `condition` (`left`/`right`/`leftfoot`/`rightfoot`), `discardS` |
| `darkness_warning` | `countdownS` |
| `perturbation_phase` | `phase` (`static`/`moving`/`after`), `tMs`, `hz`, `amplitudeM` |
| `foot_down` | `tMs`, `verticalDropM` |
| `oneleg_skipped` | `reason` (`user`/`no_space`) |
| `block_summary` | `block`, `areaMm2`, `pathMm`, `velocityMmS`, `samples`, `discardedSamples` |
| `tremor_summary` | `hand`, `rmsMm`, `peakHz`, `driftMm`, `samples` |
| `steady_abort` | `block`, `tMs`, `reason` |

**Motion logging: 90 Hz** (a képfrissítés üteme). Ez a modul az egyetlen, ahol a
mozgásnapló **maga a mérés**, nem kiegészítő adat, ezért a `maxMotionSamples`
korlátot is meg kell emelni: 5 perc × 90 Hz ≈ 27 000 minta.

Az elemzéshez szükséges minimum a **24 Hz** (a 12 Hz-es tremor Nyquist-határa);
a 90 Hz azért kell, mert a spektrum tisztasága ezen múlik, és mert egy
utólagos, ma még nem ismert elemzés nem tud olyat kiszámolni, amit nem
mintavételeztünk.

---

## 9. ADATBÁZIS

Nincs új tábla. A modul a `motion_traces` táblát használja elsődlegesen — ez az
egyetlen modul, ahol a mozgásnapló nem melléktermék.

`trials`: blokkonként egy sor. `stimulus`:
`{ block, condition, durationS, discardS, perturbationHz?, perturbationAmplitudeM? }`
`response`: `{ areaMm2, pathMm, velocityMmS, mlSdMm, apSdMm, samples, tremorRmsMm?, tremorPeakHz?, driftMm?, footDownAtMs? }`
`outcome`: `hit` (végigcsinálta) · `invalid` (letette a lábát 5 s előtt, vagy
megszakította) · `timeout` (nem indult el).

---

## 10. FELHASZNÁLÓI FOLYAMAT

**Intro.** „STEADY — Stabilitás. A headset milliméter pontosan látja, hogyan
mozdul a fejed. Ebből mérjük az egyensúlyodat és a kezed nyugalmát. Semmit nem
kell csinálnod, csak állni."

**Biztonsági képernyő (minden futás elején, kihagyhatatlan).**
„Mielőtt elkezdjük: állj olyan helyre, ahol **másfél méter szabad hely van
körülötted**, és nincs bútor a közeledben. Az egyik résznél elsötétül a kijelző.
Ha bármikor bizonytalanul állsz, **nyúlj ki és fogódzz meg** — az eredmény attól
még használható."

**Kalibráció.** „Állj kényelmesen, lábak vállszélességben, karok lazán. Nézz
előre. Ha kész vagy, nyomd meg a ravaszt." A rendszer ekkor rögzíti a
**nyugalmi fejmagasságot**, amihez az egy lábon állásnál a letételt méri.

**Blokkinstrukciók.**
- `stance`: „Csak állj. Harminc másodperc. Nézz előre, a gyűrűre."
- `dark`: „Most elsötétül a kijelző. Ne mozdulj, csak állj ugyanígy. Ha
  bizonytalan vagy, nyisd ki a szemed — a menügombbal bármikor kiléphetsz."
- `sway`: „Körülötted egy pontokból álló tér lesz. Csak állj, és nézz előre.
  Ne kövesd, ha mozogni kezd."
- `oneleg`: „**Van másfél méter szabad helyed és valaki a közelben?** Ha nincs,
  nyugodtan hagyd ki. — [FOLYTATOM] [KIHAGYOM]"
- `hand`: „Nyújtsd ki a jobb karod, és tartsd a gömböt a gyűrű közepén.
  Harminc másodperc. A karod ne támaszd meg."

**Eredményképernyő (6 sor).**

| Sor | Példaérték |
|---|---|
| Testlengés | `640 mm²` — *a lengés területe nyitott szemmel* |
| Romberg-hányados | `1,8×` — *ennyivel nő sötétben* |
| Vizuális függés | `2,1×` — *ennyire követted a mozgó teret* |
| Egy lábon | `4,3×` — *ennyivel nagyobb a lengés* |
| Kéztremor | `0,62 mm` — *jobb kéz, 8,5 Hz* |
| Kézkülönbség | `1,3×` — *a két kéz eltérése* |

Az első kiadásban kötelező kiegészítő sor:
*„Ezek az értékek a rendszeren belüli összehasonlításra alkalmasak;
erőplatós normákkal nem vethetők össze."*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A statikus poszturográfia standard mutatói (útvonalhossz,
95%-os konfidencia-ellipszis, átlagsebesség); a Romberg-próba nyitott/csukott
szem összehasonlítása; Lee és Aronson „mozgó szoba" kísérlete a vizuális
függés kimutatására; a kéznyugalom-mérés a tremorometria szokásos
sávszűrt RMS + domináns frekvencia elemzése.

**Eltérés.** (1) A jel a fej, nem a talpnyomás középpontja — ez a legfontosabb
korlát, és minden összehasonlítást befolyásol. (2) A csukott szemet
elsötétített kijelző helyettesíti (lásd 3.2). (3) A mozgó szoba eredetileg
fizikai építmény volt; itt pontrács, ami tisztább optikai áramlást ad, de
kevesebb tárgyi kontextust.

**Elvárt nagyságrend** egészséges fiatal felnőttnél, fejkövetéssel (becslés):
`sway_area_95_mm2` 300–1200 mm², `romberg_quotient` 1,2–2,5,
`visual_reliance_mm` 1–6 mm (koncentráció 0,4–0,9), `tremor_rms_mm` 0,3–1,2 mm,
`tremor_peak_freq_hz` 7–11 Hz, `single_leg_area_ratio` 2,5–7.

**Amit nem szabad kikövetkeztetni.** Neurológiai diagnózist; agyrázkódás
meglétét vagy hiányát; munkaköri alkalmasságot egyetlen felvételből. A modul
**alapvonal-és-követés** eszköz: az értéke abban van, hogy ugyanannál a
személynél ugyanazon az eszközön megismételhető.

**Tanulási hatás.** A statikus lengés a 2. felvételre jellemzően 5–15%-kal
csökken (megszokás), majd stabil. Az egy lábon állás erősebben tanulható. A
`visual_reliance_gain` a legstabilabb, mert a résztvevő jellemzően nincs
tudatában a perturbációnak — de ha egyszer felfedezi, a 2. felvételtől
tudatosan ellenállhat, ezért **a mozgó tér blokk első felvétele a
legérvényesebb**, és ezt az elemzésnek figyelembe kell vennie.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. **A mérés első 3 másodperce minden blokkban eldobásra kerül**, és ez a
   naplóban `discardS` mezőként szerepel. *Teszt: a mintaszám és a blokkhossz
   viszonya.*
2. **A 95%-os ellipszis egy ismert szórású szintetikus jelre a képlet szerinti
   értéket adja** ±12%-on belül. *Teszt: `tests/psychophysics.test.ts`.*
3. **A domináns frekvencia egy ismert frekvenciájú szintetikus jelre ±0,3 Hz-en
   belül visszanyerhető.** *Teszt: ugyanott.*
4. **A `visual_reliance_mm` egy ismert amplitúdójú, 0,20 Hz-es szintetikus
   komponensre 25%-on belül visszaadja azt az amplitúdót**, komponens nélkül
   pedig 3 mm alatt marad; a `drive_frequency_concentration` mindkét esetben
   0 és 1 közé esik. *Teszt: `tests/sport-modules.test.ts` és
   `tests/psychophysics.test.ts`.*
5. **Az `oneleg` blokk kihagyható**, és kihagyás esetén a
   `single_leg_area_ratio` hiányzik, nem nulla, a súlyok pedig 1,00-ra
   skálázódnak. *Teszt: a metrikalista és a súlyösszeg.*
6. **A láb letétele 5 s előtt `invalid` kimenetet ad**, és a mérés a letételig
   tartó szakaszra korlátozódik. *Teszt: szimulált függőleges elmozdulás.*
7. **A sötétítést hangjelzés és 3 s visszaszámlálás előzi meg**, és a blokk a
   menügombbal megszakítható. *Teszt: az eseménynapló sorrendje.*
8. **A pontrács szemcséinek szögmérete a 2,5–6,0 m tartományban 0,2 fokon belül
   azonos.** *Teszt: `2·atan(r/d)` a szélső távolságokra.*
9. **A mozgásnapló mintavételi frekvenciája legalább 60 Hz**, és a modul
   `maxMotionSamples` korlátja legalább 27 000. *Teszt: a Recorder
   konfigurációja.*
9/b. **A mérés nem az `input.pose()` kerekített csatornáján történik.**
   *Teszt: egy 0,5 mm amplitúdójú szintetikus tremor visszanyerhető; 1 mm-es
   kvantálással nem volna az.*
10. **A modul sík platformon nem indítható el**, a kártyagomb letiltott és
    megindokolt. *Teszt: `runnableVariants` / `supports`.*
11. **Két azonos seedű futás azonos perturbációs fázist ad.** *Teszt: a
    perturbáció fázisa determinisztikus a seedből.*
12. **Egy `STEADY_SHORT` futás 4 percnél nem tart tovább.** *Teszt: a
    blokkhosszak összege.*
