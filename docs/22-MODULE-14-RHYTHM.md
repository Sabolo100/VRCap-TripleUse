# 22 — MODUL 14 · RHYTHM

**Motoros időzítés & ritmusszinkronizáció**
`RHYTHM_STANDARD_A` · egyetlen változat · VR elsődleges, sík platformon szűkített

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a modul azt méri, milyen pontosan igazodik a résztvevő egy
külső ütemhez, mennyire tartja a tempót az ütem megszűnése után, és mennyit
segít neki, ha az ütemjelzés **térben mozgó tárgy** és nem villanás.

### Vizsgált konstruktumok

| Konstruktum | Definíció | Paradigma | Katalógus |
|---|---|---|---|
| Motoros időzítés | A válasz és a referenciaesemény közti időbeli eltérés nagysága és szórása | Sensorimotor synchronisation | — |
| Ritmusszinkronizáció | Külső periodikus ingerhez való fáziskapcsolódás | Szinkronizációs-folytatásos kopogás | — |
| Belső óra stabilitása | A tempó megtartása külső jelzés nélkül | Continuation tapping (Wing–Kristofferson) | — |
| Kétkezes koordináció | Két kéz egyidejű, eltérő periódusú mozgása | Polyrhythm (2:3) | 38 |
| Tempóváltás-adaptáció | Hány ütem alatt áll rá a résztvevő egy megváltozott tempóra | Tempo change / phase resetting | — |

### Amit kifejezetten NEM mér

- **Nem zenei tehetség.** A ritmusérzék a zenei képességnek csak egyik,
  alacsony szintű összetevője. A modul nem mér hangmagasságot, dallamot,
  harmóniát vagy zenei memóriát.
- **Nem sportági technika.** Az evezés vagy az úszás ciklusideje sportági
  mozgásminta; ez egy általános időzítési alapképesség, ami annak
  előfeltétele, de nem helyettesíti a technikai értékelést.
- **Nem hallásvizsgálat.** Ha a résztvevő nem hallja a hangot, az `tone`
  blokk érvénytelen — ezt jelezzük, de nem diagnosztizálunk.
- **Nem ADHD- vagy diszlexia-szűrő.** A ritmusszinkronizáció népességi
  szinten összefügg ilyen állapotokkal, de egyéni következtetés nem vonható le.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**C — Sport (elsődleges).** A ciklikus sportágakban a mozgásgazdaságosság
nagyrészt a ritmus stabilitásán múlik: az evezésben a csapatnak egyetlen
ütemre kell dolgoznia, a gátfutásban a lépésszám hibája a gátnál bukást okoz,
a szinkron sportágakban pedig maga a pontszám a szinkronitás. A `folytatás`
blokk különösen releváns: a verseny nagy részében nincs külső ütemjelzés.
*Példák: evezés, úszás, gátfutás, szinkronúszás, ritmikus gimnasztika, tánc.*

**B — Munka (másodlagos).** Ütemezett kétkezes munkavégzés és gyártósori
ciklustartás. Másodlagos, mert a munkahelyi teljesítményt ritkán korlátozza
az időzítési alapképesség — jellemzően a figyelem és a terhelés korlátozza.
*Példák: gyártósori operátor, zenész, sebészasszisztens.*

**A — Védelem (nem releváns).** A manifeszt `none` besorolása szándékos: a
védelmi kiválasztásban nincs olyan feladat, amit a ritmusszinkronizáció
előrejelezne, és a kezdőtér zsúfolása értéktelen modullal rontja a
használhatóságot. Az adatot rögzítjük (ha valaki a másik két területről érkezve
lefuttatja), de a védelmi kezdőtéren nem jelenítjük meg.

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Ütem | Gyakorlás | Idő |
|---|---|---|---|---|
| 1 | `tone` — HANGRA | 3 × (24 vezetett + 24 folytatás) | 12 | ~3,0 perc |
| 2 | `visual` — LÁTVÁNYRA | 40 + 40 + 32 + 32 vezetett | 12 | ~3,0 perc |
| 3 | `tempo` — TEMPÓVÁLTÁS | 60 ütem, 2 váltással | 8 | ~0,9 perc |
| 4 | `poly` — KÉT KÉZ | 2 × 36 ütem | 12 | ~1,6 perc |

Teljes futás **8–10 perc**.

### 3.1. `tone` — a hivatkozási alap

Három tempó, egyenként 24 vezetett és 24 folytatásos ütem:
**IOI 400 ms, 600 ms, 800 ms**, a sorrend seedelt keveréssel.

```
PREPARE          „Kopogj együtt a hanggal"                  2000 ms
COUNTDOWN        4 felvezető ütem, ezekre nem kell válaszolni
STIMULUS         24 ütem hanggal; a résztvevő minden ütemre nyom
RESPONSE WINDOW  folyamatos; minden nyomás a legközelebbi
                 ütemhez rendelődik (±IOI/2)
STIMULUS         a hang elnémul; további 24 ütemnyi idő,
                 a résztvevőnek tartania kell a tempót
FEEDBACK         csak gyakorlásban: az utolsó 8 ütem átlagos eltérése
INTER-TRIAL      3000 ms
```

**A vezetett és a folytatásos szakasz külön konstruktumot mér.** A vezetett
szakasz a fáziskapcsolódás pontossága; a folytatásos szakasz a belső óra. Egy
résztvevő lehet kiváló az elsőben és gyenge a másodikban — épp ez a
megkülönböztetés adja a modul értékét a ciklikus sportokban.

### 3.2. `visual` — a modul térbeli magja

Négy alblokk, IOI 600 ms. A próbaszámok **nem szimmetrikusak**, hanem a mérendő hatás nagyságához igazodnak (lásd lent):

| Alblokk | Az ütemjelzés | Mit mér |
|---|---|---|
| `flash` | egy gömb **felvillan** a célponton, 60 ms | diszkrét vizuális ütem |
| `moving` | egy gömb **oldalirányban áthalad** a célponton | térben folytonos ütem |
| `approach` | egy gömb **a résztvevő felé közeledve** ér a célponthoz | mélységi ütem |
| `peripheral` | mint a `moving`, de a pálya **60°-kal oldalt** van | perifériás ütem |

| Alblokk | Próba | Miért ennyi |
|---|---|---|
| `flash` | 40 | a `visual_continuity_gain` egyik tagja |
| `moving` | 40 | a másik tag, és mindhárom különbség viszonyítási alapja |
| `approach` | 32 | ~10 ms-os hatás |
| `peripheral` | 32 | ~7 ms-os hatás — a legkisebb, ezért a legkevésbé megbízható |

**Miért ez a modul létjogosultsága.** Jól dokumentált eredmény, hogy az
emberek lényegesen pontosabban szinkronizálnak hangra, mint villanó fényre —
**kivéve, ha a vizuális jelzés térben folytonosan mozog**, mert akkor a
teljesítmény megközelíti a hallásit. Az ok az, hogy egy mozgó tárgy pályája
**előrejelezhető**: a résztvevő nem az eseményre reagál, hanem a megérkezését
becsli. Ez a különbség egy villanó pont és egy mozgó test között **nem
renderelési kérdés** — a mozgás a pályán keresztül hordoz információt, és a
villanás nem hordoz semmit.

Innen származik a modul zászlóshajó-mutatója:

```
visual_continuity_gain = async_sd(flash) − async_sd(moving)
```

**A próbaszám nem esztétikai kérdés.** Egy mintaszórás standard hibája
`sd / sqrt(2(n−1))`. 24 próbánál ez egy 42 ms-os szórásra ±6,2 ms, egy 24
ms-osra ±3,5 ms, tehát a **különbség hibája ±7,1 ms** — egy 18 ms-os hatásra
ez épphogy elég, a 7 ms-os perifériás költségre viszont **egyáltalán nem**.
Szimulációval ellenőrizve (200 futás, `tests/`): a becslő torzítatlan
(17,8 a várt 18-ból), de a futásonkénti szórása 24 próbánál ±6,9 ms.

Ezért a próbaszám 40 / 40 / 32 / 32, ami a különbségek hibáját ~5,3 és
~4,2 ms-ra viszi le, és ezért **minden sd-különbség a saját standard
hibájával együtt kerül a naplóba és az eredményképernyőre**
(`visual_continuity_gain_se`, `depth_beat_cost_se`, `peripheral_beat_cost_se`).

**A saját hibájánál kisebb különbség nem kerül be a pontozásba** — nullaként
számít, nem kis mért értékként —, és az eredményképernyő kiírja:
„a mérési bizonytalanságon belül — nem értelmezhető".

Pozitív érték: a résztvevő **hasznosítja a térbeli folytonosságot**.
Nulla körüli érték: nem — ő az eseményre reagál, nem a pályát követi.

A másik két alblokk azt kérdezi, mennyire robusztus ez:
- `depth_beat_cost = async_sd(approach) − async_sd(moving)` — a mélységi
  közeledésből nehezebb sebességet becsülni, mint az oldalirányúból
- `peripheral_beat_cost = async_sd(peripheral) − async_sd(moving)` — a periféria
  időbeli felbontása jó, de a pálya megítélése pontatlanabb

### 3.3. `tempo` — tempóváltás

60 ütem folyamatosan, **hangjelzéssel**: 20 ütem 600 ms-on, 20 ütem 450 ms-on,
20 ütem 750 ms-on. A váltás **bejelentés nélkül** történik. A
`tempo_adaptation_beats` az az ütemszám, ahány ütem után az aszinkrónia
tartósan (3 egymást követő ütemen) az új tempó ±40 ms-os sávjába kerül.

### 3.4. `poly` — 2:3 keresztritmus

A bal kéz 2 ütemet, a jobb kéz 3 ütemet ad ugyanabban a 1800 ms-os ciklusban,
36 ütemnyi ideig, majd fordítva (bal 3, jobb 2). Az ütemjelzés vizuális és
folytonos: **két gömb kering** különböző periódussal, mindegyik a saját
célpontján halad át.

**A két gömb eltérő távolságban van** (0,9 m és 1,8 m), és a szögméretük
kompenzált. Ez nem díszítés: két azonos irányból, azonos szögméretben látszó,
de eltérő mélységben mozgó tárgy szétválasztása mélységi elkülönítést kíván,
és ez pontosan az a helyzet, ahol a kétkezes interferencia mérhetővé válik
anélkül, hogy a két jelzés vizuálisan összeolvadna.

---

## 4. INGERDEFINÍCIÓ

| Elem | Primitív | Méret | Szögméret | Szín |
|---|---|---|---|---|
| Célpont (gyűrű) | tórusz | 0,14 m, 1,8 m-en | 4,5° | `accent`, 0,5 opacitás |
| Ütemgömb | gömb | 0,09 m, 1,8 m-en | 2,9° | `accent2` |
| Közeledő gömb | gömb | 0,09 m (fizikai állandó) | 1,0°→5,2° | `accent2` |
| Keresztritmus-gömbök | gömb | 0,045 m / 0,09 m | 2,9° mindkettő | `accent` / `accent2` |
| Ütemhang | — | 1000 Hz, 40 ms, koszinuszos burkolóval | — | — |

A `flash` alblokk gömbje **ugyanaz a gömb ugyanott** — a különbség kizárólag az,
hogy megjelenik és eltűnik, nem pedig áthalad. Ez fontos: a két feltétel
között a fényerő, a méret és a hely azonos, egyedül a **pálya megléte** tér el,
tehát a `visual_continuity_gain` nem magyarázható fényességkülönbséggel.

### 4/B. TÉRBELISÉG — A MODUL LÉTJOGOSULTSÁGA

> **Mi változna, ha az egész jelenetet lelapítanám egyetlen gömbhéjra?**

Ez a modul őszinte önvizsgálatot igényel, mert a ritmusszinkronizáció
klasszikusan **nem térbeli** feladat: hang és gombnyomás, tér nélkül. A
`tone`, a `tempo` és a `poly` blokk időbeli magja lapítás után **változatlan
maradna**. Ha a modul csak ezekből állna, nem volna VR-modul.

Ezért van a `visual` blokk, és ezért ez a modul súlypontja:

| Ami eltűnne a lapítással | Miért |
|---|---|
| `depth_beat_cost` | egy héjon nincs közeledés; az ütem csak oldalirányban jöhet |
| `peripheral_beat_cost` | egy 32°-os képernyőn nincs 60°-os pálya |
| a `poly` blokk mélységi elkülönítése | egy héjon a két gömb ugyanabban a síkban kering |

A `visual_continuity_gain` **sík platformon is mérhető** (2D-ben is van
folytonos mozgás), és szándékosan így van: ez a mutató a szakirodalmi
eredménnyel közvetlenül összevethető marad. A térbeliség nem ezt teszi
lehetővé, hanem azt, hogy **megkérdezzük, mi az ára, ha a pálya mélységi vagy
perifériás**.

**Használt térbeli eszközök (a hatból kettő):**

| Eszköz | Az ebből származó mérőszám | Pontozásban |
|---|---|---|
| **Közeledés és pálya** | `depth_beat_cost`, és közvetve a `visual_continuity_gain` alapja | igen (0,14) |
| **Körülvevő elrendezés** | `peripheral_beat_cost` | igen (0,10) |

Kettő, mindkettő a pontozásban — ez a minimum, amit a `03-SPATIAL-DESIGN.md`
megkövetel, és a modul nem állítja magáról, hogy több.

**VR-only mutatók:** `depth_beat_cost`, `peripheral_beat_cost`,
`poly_depth_separation`.

**Szögméret-kompenzáció.** A keresztritmus két gömbje 0,9 és 1,8 m-en van,
fizikai átmérőjük 0,045 és 0,09 m — a szögméretük tehát azonos (2,9°). A
közeledő gömb az egyetlen kivétel, ahol a szögméret szándékosan nő: ott a
tágulás maga az időzítési jelzés.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Feladatelem | VR | Desktop | Mobil | Besorolás |
|---|---|---|---|---|
| Ütem jelzése (egy kéz) | ravasz | Szóköz | koppintás | `equivalent` |
| Kétkezes ütem | bal/jobb ravasz | `F` / `J` | két oldal koppintás | `equivalent` |
| Hangütem | térbeli hang a célpont felől | sztereó | sztereó | `adapted` |
| `flash` / `moving` alblokk | 1,8 m-en | képernyőn | képernyőn | `adapted` |
| `approach` alblokk | 6,0 m → 1,2 m | — | — | **`vr-only`** |
| `peripheral` alblokk | 60° oldalt | — | — | **`vr-only`** |
| Keresztritmus mélységi elkülönítés | 0,9 / 1,8 m | egy síkon | egy síkon | **`vr-only`** |

**Az időzítés kvantálása platformonként eltér, és ez a modul legfontosabb
keresztplatform-korlátja.** A VR-kontroller gombja képkockánként pollozott
(Quest 3-on 11,1 ms), a DOM-billentyű viszont eseményvezérelt (< 1 ms). Egy
11 ms-os kvantálás egy 20 ms-os aszinkrónia-szórásba **érdemi zajt visz**.
Ezért:

1. Minden válasz `quantisationMs` mezővel naplózódik.
2. A `comparability` kulcs elválasztja az eszközosztályokat, és a
   ranglista soha nem keveri őket.
3. Az eredményképernyő VR-ben kiírja a kvantálást: *„A mérés felbontása
   ezen az eszközön 11 ms."*

### Sík platformon kieső metrikák

`depth_beat_cost`, `peripheral_beat_cost`, `poly_depth_separation`.
Ezek **hiányoznak**, nem nullák; a `spatial_beat_robustness` score-összetevő
súlya 0, a maradék öt arányosan felskálázódik, és az eredményképernyő kiírja.

### `controlHint`

- **VR:** `RAVASZ: ütem · BAL/JOBB RAVASZ: keresztritmus`
- **Desktop:** `SZÓKÖZ: ütem · F / J: keresztritmus`
- **Mobil:** `KOPPINTÁS: ütem · bal/jobb oldal: keresztritmus`

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

**Amitől nehezebb:** gyorsabb tempó (rövidebb IOI), a hang elvétele, a
folytatásos szakasz hossza, a keresztritmus, a mélységi és perifériás pálya.

| Paraméter | `RHYTHM_STANDARD_A` | `RHYTHM_SHORT` |
|---|---|---|
| `tone` tempók | 400 / 600 / 800 ms | 600 ms |
| `tone` ütem tempónként | 24 + 24 | 20 + 20 |
| `visual` alblokkok | 4 × 24 | 2 × 20 (`flash`, `moving`) |
| `tempo` ütem | 60 (3 × 20) | 40 (2 × 20) |
| `poly` ütem | 2 × 36 | 1 × 36 |
| Becsült idő | 9–11 perc | 4,5 perc |

**CHALLENGE mód.** Az IOI folyamatosan rövidül, amíg az aszinkrónia szórása
egy küszöb fölé nem megy; a pontszám a legrövidebb tartott tempó. Ez más
konstruktumot mér (maximális ütemsebesség, nem pontosság), ezért **nem kerül
egy normacsoportba** az assessment futásokkal.

---

## 7. METRIKÁK

### Nyers (ütemenként)

`beatIndex`, `beatTime` (a tervezett ütem ideje), `tapTime`, `asynchronyMs`
(tap − beat, előjeles), `iti` (az előző nyomás óta eltelt idő), `blockId`,
`subBlock`, `hand`, `quantisationMs`.

### Származtatott

| Metrika | Definíció | Egység |
|---|---|---|
| `async_mean_ms` | az aszinkróniák átlaga a vezetett szakaszokon; **negatív a szokásos** | ms |
| `async_sd_ms` | az aszinkróniák szórása — **a fő pontossági mutató** | ms |
| `async_sd_400` / `_600` / `_800` | ugyanez tempónként | ms |
| `continuation_sd_ms` | az ütemközök szórása a folytatásos szakaszban | ms |
| `continuation_drift_ms_per_beat` | az ütemközök regressziós meredeksége a sorszámra | ms/ütem |
| `visual_continuity_gain` | `async_sd(flash) − async_sd(moving)` | ms |
| `visual_continuity_gain_se` | ugyanennek a standard hibája: `hypot(sd_f/√(2(n_f−1)), sd_m/√(2(n_m−1)))` | ms |
| `depth_beat_cost_se` / `peripheral_beat_cost_se` | ugyanígy a két térbeli költséghez | ms |
| `depth_beat_cost` | `async_sd(approach) − async_sd(moving)` | ms |
| `peripheral_beat_cost` | `async_sd(peripheral) − async_sd(moving)` | ms |
| `auditory_visual_gap` | `async_sd(flash) − async_sd(tone 600 ms)` | ms |
| `tempo_adaptation_beats` | hány ütem után marad 3 egymást követő ütemen az új tempó ±40 ms-os sávjában | ütem |
| `poly_accuracy` | a keresztritmusban helyes fázisú ütemek aránya (±IOI/4) | arány |
| `poly_async_sd` | az aszinkrónia szórása a keresztritmusban | ms |
| `poly_depth_separation` | a közeli és a távoli kéz aszinkrónia-szórásának különbsége | ms |
| `missed_beat_rate` | válasz nélkül maradt ütemek aránya | arány |

### Score-összetevők

| Összetevő | Képlet | `good` | `poor` | Súly (VR) | Súly (sík) |
|---|---|---|---|---|---|
| `timing_precision` | `async_sd_ms` | 16 ms | 60 ms | 0,26 | 0,30 |
| `internal_clock` | `continuation_sd_ms` | 22 ms | 80 ms | 0,22 | 0,26 |
| `visual_continuity_use` | `visual_continuity_gain` | 22 ms | 0 ms | 0,16 | 0,19 |
| `bimanual_polyrhythm` | `poly_accuracy` | 0,88 | 0,42 | 0,14 | 0,16 |
| `tempo_adaptation` | `tempo_adaptation_beats` | 3 | 14 | 0,12 | 0,09 |
| `spatial_beat_robustness` | `(depth_beat_cost + peripheral_beat_cost)/2`, a saját hibájuknál kisebb tagokat nullázva | 4 ms | 30 ms | 0,10 | **0** |

VR: 0,26+0,22+0,16+0,14+0,12+0,10 = **1,00**. Sík: 0,30+0,26+0,19+0,16+0,09 = **1,00**.

**Az `internal_clock` a folytatásos szakasz ütemközszórása, nem az
aszinkróniáé** — a folytatásos szakaszban nincs ütem, amihez képest
aszinkróniát lehetne számolni. Ez a Wing–Kristofferson elemzés belépési pontja,
és a modul ezt a nyers adatot rögzíti, hogy a bomlás (óra- vs. motoros variancia)
később elvégezhető legyen.

**Horgonyértékek.** A 16 ms / 60 ms tartomány a kopogásos irodalom
nagyságrendje 600 ms-os IOI-nál, **de az eszköz kvantálása ezt eltolja**:
11 ms-os pollozás önmagában ~3,2 ms szórást ad hozzá négyzetes összegzésben.
Az értékek ezért provizórikusak, és eszközosztályonként külön kell kalibrálni.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `rhythm_setup` | `platform`, `iois`, `subBlocks`, `quantisationMs`, `targetDistanceM` |
| `beat` | `blockId`, `subBlock`, `beatIndex`, `ioiMs`, `paced`, `sourceKind` (`tone`/`flash`/`moving`/`approach`/`peripheral`), `azDeg`, `radiusM` |
| `tap` | `blockId`, `subBlock`, `hand`, `asynchronyMs`, `matchedBeatIndex`, `itiMs`, `quantisationMs` |
| `beat_missed` | `beatIndex`, `subBlock` |
| `phase_change` | `blockId`, `phase` (`paced`/`continuation`), `beatIndex` |
| `tempo_change` | `fromIoiMs`, `toIoiMs`, `atBeat` |
| `poly_cycle` | `cycleIndex`, `leftBeats`, `rightBeats`, `nearHand` |
| `block_summary` | `blockId`, `subBlock`, `asyncMeanMs`, `asyncSdMs`, `n`, `missed` |

**Motion logging: 10 Hz.** Ebben a modulban a kéz helye nem hordoz információt
(a válasz gombnyomás), a fej mozgása pedig csak a `peripheral` alblokk
érvényességéhez kell — ahhoz 10 Hz elég. Ez a legalacsonyabb frekvencia a
katalógusban, és szándékosan az: fölösleges mintát venni olyasmiről, ami nem
befolyásol egyetlen mutatót sem.

---

## 9. ADATBÁZIS

Nincs új tábla. Egy `trials` sor **egy ütem**.

`stimulus`: `{ block, subBlock, beatIndex, ioiMs, paced, sourceKind, azDeg, radiusM, platform }`
`response`: `{ asynchronyMs, itiMs, hand, quantisationMs, matchedBeatIndex }`
`outcome`: `hit` (±IOI/2-n belüli válasz) · `miss` (nincs válasz) ·
`false_alarm` (két nyomás egy ütemre).

Az ütemenkénti sor sok rekordot jelent (kb. 400 egy teljes futásban), de ez a
modul egyetlen értékes nyersadata: az aszinkrónia-sorozatból utólag
kiszámolható a Wing–Kristofferson bomlás, az autokorreláció és a
fáziskorrekciós erősség — egyik sem rekonstruálható összesített értékekből.

---

## 10. FELHASZNÁLÓI FOLYAMAT

**Intro.** „RHYTHM — Ütem. Először együtt kopogsz egy hanggal, aztán a hang
elhallgat, és neked kell tartanod a tempót."

**Instrukció (`tone`).** „Hallani fogsz egy egyenletes ütemet. Nyomd meg a
ravaszt **minden ütemre**, pontosan akkor, amikor megszólal. Aztán a hang
elhallgat — te viszont **ugyanabban a tempóban kopogj tovább**, amíg meg nem
állítalak."

**Kalibráció.** 8 ütem 600 ms-on, visszajelzéssel: „Most gyakorlunk. Látni
fogod, mennyivel vagy előrébb vagy hátrébb." Ez egyben a **kvantálás
bemutatása** is: az eredményképernyőn megjelenő felbontás itt válik érthetővé.

**Instrukció (`visual`).** „Most nincs hang. Az ütemet **látni** fogod: egy gömb
érkezik a gyűrűhöz. Akkor nyomj, amikor a gömb **a gyűrűben van**. Néha
felvillan, néha áthalad, néha feléd jön."

**Instrukció (`poly`).** „Két gömb kering, különböző sebességgel. A **bal
kezed a közelebbihez**, a **jobb a távolabbihoz** tartozik. Mindkettőre nyomj,
amikor a saját gyűrűjébe ér. Ez nehéz — nem baj, ha nem sikerül tökéletesen."

**Eredményképernyő (6 sor).**

| Sor | Példaérték |
|---|---|
| Időzítési pontosság | `24 ms` — *szórás; a fő mutató* |
| Előretartás | `−31 ms` — *az emberek jellemzően megelőzik az ütemet* |
| Belső óra | `38 ms` — *hang nélkül ennyit ingadozol* |
| Tempódrift | `+1,8 ms/ütem` — *lassulsz, amikor elhallgat a hang* |
| Mozgó ütem előnye | `+18 ± 5 ms` — *ennyivel pontosabb mozgó jelzésre* |
| Keresztritmus | `71%` |

VR-ben kötelező kiegészítő sor: *„A mérés felbontása ezen az eszközön 11 ms."*

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A szinkronizációs-folytatásos kopogási paradigma (Stevens;
Wing és Kristofferson variancia-bontása); a vizuális és auditoros
szinkronizáció különbsége, illetve annak eltűnése térben folytonosan mozgó
vizuális jelzésnél; a 2:3 keresztritmus a kétkezes koordináció standard
próbája; a tempóváltásos szakasz a fáziskorrekció és a periódus-korrekció
elkülönítésére szolgál.

**Eltérés.** (1) A klasszikus eljárás ujjal kopog egy érzékelőre; itt
kontrollergomb vagy billentyű, ami nagyobb és eszközfüggő motoros késleltetést
ad — a **szórás** ettől alig változik, az **átlag** viszont igen, ezért a
konstans eltolás nem hasonlítható irodalmi értékekhez. (2) A vizuális
alblokkok mélységi és perifériás változata a szakirodalomban nem szerepel;
ezek a paradigma **kiterjesztései**, és mint ilyenek, kalibrálatlanok.

**Elvárt nagyságrend** egészséges felnőttnél, 600 ms IOI-n (becslés):
`async_mean_ms` −80…−10 ms, `async_sd_ms` 18–45 ms, `continuation_sd_ms`
25–70 ms, `visual_continuity_gain` 8–30 ms, `poly_accuracy` 0,45–0,85.

**Amit nem szabad kikövetkeztetni.** Zenei alkalmasságot; sportági
technikai szintet; neurológiai állapotot. A negatív átlagos aszinkrónia
**normális jelenség**, nem hiba, és nem szabad „sietésként" értelmezni a
résztvevő felé.

**Tanulási hatás.** A `poly` blokk erősen tanulható: a 2. felvételre 10–20
pontos javulás szokásos. A `async_sd_ms` a legstabilabb. A
`visual_continuity_gain` közepesen stabil, de ha a résztvevő tudatosítja a
stratégiát („a pályát kell nézni"), a 2. felvételtől nő — ezért az első
felvétel a legérvényesebb.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. **Egy nyomás mindig a legközelebbi ütemhez rendelődik**, ±IOI/2-n belül, és
   két nyomás nem rendelhető ugyanahhoz az ütemhez. *Teszt: szintetikus
   nyomássorozat ismert hozzárendeléssel.*
2. **Az ütemidőket a modul előre ütemezi**, nem a válaszokhoz igazítja: a
   `beatTime` sorozat pontosan `k × IOI`, a driftje 0. *Teszt: az ütemidők
   különbségeinek szórása < 1 ms.*
3. **Egy ismert aszinkrónia-sorozatra a modul visszaadja az átlagot és a
   szórást** ±0,5 ms-on belül. *Teszt: `tests/sport-modules.test.ts`.*
3/b. **Minden sd-különbség a standard hibájával együtt kerül ki**, és a saját
   hibájánál kisebb különbség nullaként lép a pontozásba. *Teszt: két olyan
   alblokk, amelynek szórása 0,5 ms-ban tér el, nem rontja a
   `spatial_beat_robustness` pontszámot.*
4. **A folytatásos szakasz drift-értéke egy ismert lassulásra visszanyerhető**
   ±0,2 ms/ütem pontossággal. *Teszt: `tests/psychophysics.test.ts`.*
5. **A `flash` és a `moving` alblokk gömbje azonos méretű, színű és helyű** a
   célpontban; egyedül a pálya megléte tér el. *Teszt: a geometria
   paraméterei.*
6. **Sík platformon a `depth_beat_cost` és a `peripheral_beat_cost` hiányzik**,
   nem nulla, és a súlyok 1,00-ra skálázódnak. *Teszt: a metrikalista és a
   súlyösszeg.*
7. **A keresztritmus két gömbjének szögmérete 0,2 fokon belül azonos**
   (0,045 m @ 0,9 m és 0,09 m @ 1,8 m). *Teszt: `2·atan(r/d)`.*
8. **Minden válasz `quantisationMs` mezővel naplózódik**, és VR-ben ez a
   képkockaidő. *Teszt: az eseménynapló mezői.*
9. **Két azonos seedű futás azonos tempósorrendet és alblokk-sorrendet ad.**
   *Teszt: két `Rng(42)` futás.*
10. **A `tempo` blokk váltásai bejelentés nélkül történnek**, és a
    `tempo_change` esemény rögzíti a váltás ütemét. *Teszt: az eseménynapló.*
11. **Egy `RHYTHM_SHORT` futás 5 percnél nem tart tovább.** *Teszt: az
    ütemszámok és IOI-k szorzatösszege.*
12. **Az `A` (védelmi) területen a modul nem jelenik meg a kezdőtéren**,
    de az adat rögzül, ha mégis lefut. *Teszt: a `domains.A.relevance === 'none'`
    és a kezdőtér szűrése.*
