# 18 — MODUL 08: HOLD
## Válaszgátlás & impulzuskontroll — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/hold/HoldModule.ts`
**Támogatott platformok:** VR (teljes) · asztali, mobil (a pályaítélet blokk szűkítve)
**Névleges időtartam:** ~8 perc
**Doménkötés:** A elsődleges · B elsődleges · C elsődleges

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a HOLD azt méri, milyen gyorsan tud valaki cselekedni,
amikor kell, **és milyen gyorsan tudja visszavonni a már megindított
cselekvést**, amikor kiderül, hogy mégsem szabad.

### Miért közelednek a tárgyak

A klasszikus go/no-go feladatban egy alakzat megjelenik a képernyőn.
Ez a modul helyette **feléd repülő testeket** használ: a tárgy 9–14 m-ről
indul, forogva közeledik, és a döntést azelőtt kell meghozni, hogy odaérne.

Ez nem díszítés, három mérési következménye van:

1. **A határidő fizikai, nem önkényes.** Egy képernyős feladatban a
   válaszablak egy szám, amit a kísérletvezető választ. Itt a határidő az,
   hogy a tárgy odaér — ezt a résztvevő látja, becsüli és érzi. A
   sürgősség természetes.
2. **A döntés folyamatosan érik.** A tárgy közeledése alatt az inger
   egyre nagyobb és egyértelműbb, tehát a résztvevő eldöntheti, mikor
   kötelezi el magát. A `commitment_fraction` (a pálya hányad részénél
   válaszolt) így önálló mutató: az impulzív résztvevő korán,
   kevés információval dönt.
3. **A pálya maga lehet a döntési változó.** A 3. blokkban a szín
   irreleváns: csak arra kell reagálni, ami **ténylegesen eltalálna**.
   Ez mélységi és irányítélet — sík kijelzőn nincs megfelelője.

### A modul tudományos gerince: az SSRT

A go/no-go feladat megmondja, **hányszor** nem sikerült visszatartani a
választ. Nem mondja meg, **milyen gyors** a gátlási folyamat maga.
Erre való a stop-signal paradigma, és ez a modul 2. blokkja.

A logika a versenymodell: minden próbában verseny zajlik a *go* folyamat és
a *stop* folyamat között. Ha a stop előbb ér célba, a válasz elmarad. A
stopjel késleltetését (SSD) lépcsőzetesen hangoljuk úgy, hogy a résztvevő az
esetek felében állítson meg — ekkor az SSD éppen a gátlási folyamat
időtartamával rövidebb a go-folyamaténál, tehát:

```
SSRT = (a go-RT eloszlás p(respond|signal)-edik percentilise) − átlagos SSD
```

Az integrációs módszert használjuk, mert az átlagalapú változat torzít, ha a
lépcső nem konvergált tökéletesen 50%-ra.

**Az SSRT az egyetlen olyan mutató a platformon, ami a gátlásnak
látenciát ad**, nem csak hibaszázalékot. Két résztvevő azonos
commission-hibaszázalékkal gyökeresen különbözhet SSRT-ben.

### Mért konstruktumok

| Konstruktum | Katalógus # | Blokk | Paradigma |
|---|---|---|---|
| Válaszgátlás | 63 | 1, 2 | Go/No-Go, Stop-signal |
| Impulzuskontroll | 63 | 1–4 | Elköteleződési arány |
| Választásos reakcióidő | 32 | 1 | Go RT |
| Célpont-megkülönböztetés | 114 | 1, 3 | — |
| Szabályváltás költsége | 136 | 4 | Rule reversal |
| Döntés bizonytalanságban | 52 | 3 | Pályaítélet |
| Sebesség–pontosság egyensúly | 134 | 1–4 | — |

### Amit a modul NEM mér

- **Nem lövészet és nem harci döntés.** Absztrakt testek, nincs
  embermodell, fegyver, civil vagy ellenség. A „shoot / no-shoot" a
  katalógusban indirekt (I) besorolású, és az is marad: a modul az alatta
  lévő gátlási gépezetet méri, nem a beavatkozási szabályok ismeretét.
- **Nem impulzivitás mint személyiségvonás.** Megfigyelt gátlási
  teljesítményt mér egy adott napon. Az „impulzív" szó az eredményben nem
  szerepel.
- **Nem ADHD-szűrés.** A gátlási mutatók érzékenyek rá, de a diagnózis
  klinikai eljárás, és ez a modul nem az.
- **Nem ütközéselkerülési képesség.** A 3. blokk pályaítélete
  laboratóriumi absztrakció, nem járművezetési szimuláció.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** A tűzmegnyitási fegyelem absztrakt
megfelelője. Operatívan a gátlási hiba drágább, mint a késés — a pontozás
ezt tükrözi: a commission-hiba kétszeres súllyal esik latba az omisszióhoz
képest. A 4. blokk szabályváltása az a helyzet, amikor a beavatkozási
szabály menet közben módosul, és a régi szerint reagálni veszélyes.
Beosztások: harcoló beosztás, ellenőrzőpont-szolgálat, rendész, őr.

**B — Munkaalkalmasság (elsődleges).** Vészleállítás, elhamarkodott
beavatkozás visszatartása, protokollfegyelem. A gátlási lassúság
munkabaleseti kockázati tényező azoknál a munkaköröknél, ahol a gép már
mozog, mire kiderül, hogy meg kell állítani.
Munkakörök: gépkezelő, daruvezető, sofőr, sebész, vegyipari operátor.

**C — Sport (elsődleges).** A kapus és a védő cselre reagálva megállítja a
már megkezdett mozdulatot; a sprinter visszatartja a kilépést. Ez pontosan
a stop-signal képesség, és az SSRT az a szám, ami az edzőt érdekli.
Sportágak: kapusposzt, vívás, kosárlabda-védekezés, sprintrajt, küzdősportok.

---

## 3. FELADATSTRUKTÚRA

Minden blokkban ugyanaz az alaphelyzet: egy test 9–14 m-ről indul,
forogva közeledik 3,5–6 m/s sebességgel, és 1,2 m-nél „elhalad".
A menetidő 1,6–3,6 s.

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | GO / NO-GO | 8 | 60 | ~2:20 | prepotens válasz visszatartása |
| 2 | STOP-JEL | 8 | 56 | ~2:20 | **SSRT** — a gátlás sebessége |
| 3 | PÁLYA | 6 | 36 | ~1:30 | mélységi és irányítélet |
| 4 | SZABÁLYVÁLTÁS | 4 | 40 | ~1:40 | szabály felülírása menet közben |

### 3.1. Blokk 1 — Go / No-Go

**Szabály:**
- **PIROS + PULZÁLÓ** → reagálj (go)
- **PIROS, nem pulzáló** → tartsd vissza
- **KÉK** (bármilyen) → tartsd vissza

**Arány:** 72% go, 28% no-go. A go-túlsúly szándékos: enélkül nem alakul
ki prepotens válasz, és nincs mit visszatartani. Ez a paradigma lelke.

A no-go próbák fele „piros, nem pulzáló" (a nehezebb eset: a szín go-t
sugall), fele kék (könnyebb).

```
PREPARE          700–1400 ms   üres tér
STIMULUS         a menetidő     a test indul és közeledik
                 - a szabály a teljes út alatt látható
                 - válasz bármikor elfogadható az indulástól
RESPONSE         0
FEEDBACK         600 ms gyakorláskor, 0 mérés közben
INTER-TRIAL      450 ms
```

**Nagyon korai válasz** (a menetidő 15%-a előtt) `invalid`: a résztvevő
azelőtt döntött, hogy az ingert azonosíthatta volna.

### 3.2. Blokk 2 — Stop-jel

**Minden próba go-ként indul**: a test piros és pulzál, reagálni kell.
A próbák **28%-ában** azonban repülés közben **stopjel** érkezik:
a test **fehérré vált és felvillan**, egyidejűleg egy rövid 320 Hz-es
tónus szól. Ekkor a választ vissza kell tartani.

**A stopjel késleltetése (SSD) lépcsőzetes.** Kezdőérték 250 ms.
- Sikeres megállítás után **+50 ms** (nehezebb lesz),
- sikertelen megállítás után **−50 ms** (könnyebb lesz).
- Tartomány: 50–1200 ms.

A lépcső így a p(respond|signal) = 0,5 pont körül konvergál, ami az
SSRT-becslés feltétele.

**Fontos kényszer:** a stopjel csak akkor lőhető ki, ha az SSD után még
marad legalább 300 ms a becsapódásig. Ha nem, a próba go-próbaként fut le,
és nem számít bele a lépcsőbe — különben a lépcső a menetidőbe, nem a
gátlási képességbe futna bele.

### 3.3. Blokk 3 — Pálya

**A szín irreleváns.** Minden test szürke. A szabály:

> Reagálj arra, ami **eltalálna**. Tartsd vissza, ami **elmegy melletted**.

- **50%** ütközési pálya (a fej ±0,35 m-es gömbjét metszi),
- **50%** elkerülő pálya (0,9–1,8 m-rel elmegy mellette).

A megkülönböztetés kizárólag mélységi és irányinformációból lehetséges:
egy közeledő tárgy retinaképe akkor tágul szimmetrikusan, ha ütközési
pályán van. Ez az az ítélet, aminek sík kijelzőn nincs megfelelője —
ott a mozgásparallaxis és a diszparitás hiányzik.

**Sík platformon** az elkerülési távolság 2,4–3,6 m-re nő, hogy a
laterális elmozdulás egyáltalán észlelhető legyen. Az eredmény
eszközosztályonként külön kezelendő, és a spec ezt kimondja.

### 3.4. Blokk 4 — Szabályváltás

Az 1. blokk szabálya, de a **20. mért próbánál a szabály megfordul**:

> Mostantól a PULZÁLÓ jelenti, hogy vissza kell tartani, és a
> nem pulzáló piros az, amire reagálni kell.

A megfordulást egy 1500 ms-os felirat jelzi, egyszer.
A `rule_change_cost` a megfordulás előtti és utáni 5-5 próba
pontosságkülönbsége.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szín |
|---|---|---|---|
| Go / no-go test | kocka, gömb, kúp, tórusz — próbánként váltakozva | 0,34 m | `#FF4D4D` piros / `#3D9DFF` kék |
| Stopjel állapot | ugyanaz a test | 0,34 m | `#FFFFFF`, 2,4-szeres fényerő |
| Pálya-blokk test | ugyanaz a készlet | 0,34 m | `#8FA6BF` semleges szürke |
| Elhaladási sík | ring | 1,1 m | halvány, a résztvevő körül 1,2 m-nél |
| Szabálypanel | panel | 0,52 × 0,13 m | felül, a látómezőn kívül eső részen |

**Forgás.** Minden test saját, véletlen tengely körül forog 0,6–1,6 rad/s
sebességgel. Ez adja a struktúrát a mozgásból: a test **tömör
testként** olvasható, nem sziluettként. A forgás soha nem rejti el a
diszkriminatív jegyet, mert a szín és a pulzálás minden nézetből látszik.

**Pulzálás (a go-jegy).** Az emissziós fényerő 3,3 Hz-en 0,45 és 1,0
között ingadozik. Ez elég gyors ahhoz, hogy azonnal felismerhető legyen,
és elég lassú ahhoz, hogy egyetlen frame-en ne legyen összetéveszthető.

**Indulási hely.** Azimut ±38° (VR) / ±24° (asztali), elevatio ±18° / ±12°,
távolság 9–14 m. Az irányok között a felhasználó **fejmozgással** követi a
testet — ez természetes, és a VR-ben a feladat része.

**Hang.** Indulásnál nincs hang (az időzítési támpont lenne).
A stopjelnél 320 Hz, 120 ms, egyidejűleg a vizuális váltással.
Gyakorláskor helyes válaszra 880 Hz, hibás gátlásra 180→120 Hz.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1 Go/No-Go | `adapted` | Az indulási szögtartomány igazodik a viewporthoz. |
| 2 Stop-jel | `equivalent` | Az SSD és a válasz idő szerinti; a geometria nem számít bele. |
| 3 Pálya | `adapted` | Diszparitás és parallaxis nélkül a küszöb más — az elkerülési távolság nő. |
| 4 Szabályváltás | `adapted` | Mint az 1. blokk. |

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Indulási azimut | ±38° | ±24° | ±20° |
| Indulási elevatio | ±18° | ±12° | ±11° |
| Indulási távolság | 9–14 m | 9–14 m | 9–14 m |
| Menetidő | 1,6–3,6 s | azonos | azonos |
| Elkerülési távolság (3. blokk) | 0,9–1,8 m | 2,4–3,6 m | 2,6–3,8 m |
| Teströtáció | 0,6–1,6 rad/s | azonos | azonos |

### Platformonként kieső metrikák

| Metrika | VR | Asztali / mobil |
|---|---|---|
| `trajectory_d_prime` | ✓ | ✓, de **más küszöbön** — nem összevethető |
| `head_tracking_gain` (követte-e fejjel a testet) | ✓ | **kiesik** |
| SSRT, commission, omisszió, szabályváltás | ✓ | ✓ |

### Irányítási szöveg platformonként

| Blokk | VR | Asztali | Mobil |
|---|---|---|---|
| 1, 4 | „Húzd meg a ravaszt, ha a test PIROS ÉS PULZÁL. Minden másra ne reagálj." | „Kattints vagy nyomj SZÓKÖZT, ha a test PIROS ÉS PULZÁL." | „Koppints, ha a test PIROS ÉS PULZÁL." |
| 2 | „Minden testre reagálj — kivéve, ha közben FEHÉRRE VÁLT és megszólal a hang. Akkor tartsd vissza." | ugyanaz, SZÓKÖZ-zel | ugyanaz, koppintással |
| 3 | „A szín most nem számít. Csak arra reagálj, ami ELTALÁLNA. Ami elmegy melletted, arra ne." | ugyanaz | ugyanaz |

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: a go-arány (magasabb = erősebb prepotens válasz), a
menetidő (rövidebb = nehezebb), az SSD-lépcső lépésköze, a pályablokk
elkerülési távolsága, a szabályváltások száma.

### `HOLD_STANDARD_A` (alapértelmezés)

```
gonogoTrials 60   goRate 0.72   travelMs [1600,3600]   startR [9,14]
stopTrials 56     stopRate 0.28  ssdStart 250  ssdStep 50  ssdRange [50,1200]
                  minRemainAfterSsd 300
trajectoryTrials 36  hitRate 0.5  missOffset [0.9,1.8]  headRadius 0.35
reversalTrials 40    reversalAt 20
earlyRejectFraction 0.15
```

### `HOLD_SHORT` (~4,5 perc)

```
gonogoTrials 32   stopTrials 32   trajectoryTrials 20   reversalTrials 22 (reversalAt 11)
```

### CHALLENGE mód

Rövidebb menetidő (1,1–2,2 s), 80%-os go-arány, élő pontszám.
**Az assessment eredménnyel nem keverhető**, mert az SSD-lépcső más
egyensúlyi pontra fut be, és az SSRT nem összevethető.

---

## 7. METRIKÁK

### Nyers (próbánként)
`block` · `trialType` (`go` / `nogo` / `stop` / `hit_path` / `miss_path`) ·
`shapeKind` · `colorKind` · `pulsing` · `travelMs` · `startAzDeg` ·
`startElDeg` · `startRadius` · `ssdMs` · `stopSignalFired` ·
`responded` · `rtMs` · `commitmentFraction` · `afterReversal` · `outcome`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `go_rt_median` | Medián RT a helyes go-próbákon |
| `go_rt_sd` | RT szórása a go-próbákon |
| `go_omission_rate` | Válasz nélküli go-próbák aránya |
| `commission_error_rate` | **Fő gátlási hibamutató.** Válaszolt no-go próbák aránya |
| `commission_rate_red` / `commission_rate_blue` | Bontva a nehéz és könnyű no-go szerint |
| `nogo_d_prime` | Jelészlelés-elméleti érzékenység go és no-go között |
| `commitment_fraction` | A pálya hányad részénél érkezett a válasz, medián. Kicsi = korán elkötelezi magát |
| `commitment_fraction_error` | Ugyanez a commission-hibás próbákon — az impulzív próbák markere |
| `ssrt` | **Stop-signal reakcióidő** integrációs módszerrel: a go-RT eloszlás p(respond\|signal)-edik percentilise mínusz az átlagos SSD |
| `mean_ssd` | Átlagos stopjel-késleltetés |
| `p_respond_signal` | A stopjeles próbákon adott válaszok aránya; 0,5 közelében a lépcső konvergált |
| `ssd_convergence` | \|p_respond_signal − 0,5\|; 0,15 fölött az SSRT bizonytalan |
| `stop_failure_rt` | RT a sikertelen megállításokon; a versenymodell szerint rövidebb a go-RT mediánjánál |
| `race_model_ok` | 1, ha `stop_failure_rt` < `go_rt_median` — a modell alapfeltevésének ellenőrzése |
| `trajectory_d_prime` | Ütközési és elkerülő pálya megkülönböztetése |
| `trajectory_hit_rate` / `trajectory_fa_rate` | Bontva |
| `rule_change_cost` | Pontosság(megfordulás előtti 5) − pontosság(utáni 5) |
| `perseveration_errors` | A megfordulás utáni első 10 próbában a **régi** szabály szerinti válaszok |
| `post_error_slowing` | RT-növekedés a hiba utáni próbán |
| `head_tracking_gain` | A fejirány és a test iránya közti korreláció (**VR**) |

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `inhibition_accuracy` | commission 0,02 | 0,45 | Go/no-go tipikus tartomány |
| `inhibition_speed` | SSRT 180 ms | 420 ms | Stop-signal irodalom felnőtt tartománya; **provizórikus** |
| `go_performance` | omisszió 0,01 és RT 420 ms | 0,20 / 900 ms | |
| `trajectory_judgement` | *d′* 3,0 | 0,5 | |
| `rule_flexibility` | `rule_change_cost` 0 | 0,45 | |
| `decision_discipline` | `commitment_fraction` 0,75 | 0,35 | Későbbi elköteleződés = több információ |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Gátlási pontosság (commission) | 0,26 |
| Gátlási sebesség (SSRT) | 0,24 |
| Go-teljesítmény | 0,16 |
| Pályaítélet | 0,14 |
| Szabály-rugalmasság | 0,12 |
| Döntési fegyelem | 0,08 |

**A gátlás két összetevője együtt 50%.** Ez szándékos, és eltér a REACT
súlyozásától: ott a sebesség a fő, itt a visszatartás.

**Aszimmetrikus hibabüntetés.** A `go_performance` score-ban az omisszió
horgonyai megengedőbbek, mint a commission horgonyai az
`inhibition_accuracy`-ban: egy elmulasztott go-válasz operatívan
kevésbé költséges, mint egy vissza nem tartott no-go válasz.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `object_launched` | shapeKind, colorKind, pulsing, travelMs, startAz, startEl, startRadius, trialType, collision, quantisationMs |
| `stop_signal` | ssdMs, remainingMs, elapsedMs |
| `hold_response` | rtMs, commitmentFraction, trialType, correct |
| `hold_inhibited` | trialType, ssdMs (ha volt stopjel) |
| `ssd_step` | direction (`up`/`down`), newSsdMs |
| `early_reject` | fraction |
| `rule_reversal` | trialIndex |
| `object_passed` | responded, trialType |

**Mozgásnaplózás: 25 Hz.** A fej és a kéz pályája itt valódi metrika:
a `head_tracking_gain` azt mutatja, követte-e a résztvevő a testet a
fejével, és a kéz pályájából a megkezdett-de-visszavont mozdulat
(részleges válasz) utólag elemezhető. Ez utóbbi a stop-signal kutatás
egyik legérdekesebb jelensége, és a nyers adatból később kinyerhető.

---

## 9. ADATBÁZIS

Új tábla nem kell.

```jsonc
// trials.stimulus
{ "kind": "hold", "block": "stop", "trialType": "stop", "shapeKind": "cone",
  "colorKind": "red", "pulsing": true, "travelMs": 2400, "startAzDeg": -41.2,
  "startElDeg": 7.8, "startRadius": 11.6, "ssdMs": 300, "stopSignalFired": true,
  "collision": true, "afterReversal": false, "platform": "vr", "practice": false }

// trials.response
{ "rtMs": 512.3, "commitmentFraction": 0.42, "responded": true }
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „HOLD / Válaszgátlás & impulzuskontroll”, négy blokk.
   Kiemelve: *„A tesztek többségében a gyorsaság a cél. Ebben nem: itt
   ugyanolyan fontos, hogy mikor NE csinálj semmit.”*
2. **INSTRUKCIÓ** blokkonként; az 1. blokknál a három ingertípus
   lassított bemutatásával.
3. **GYAKORLÁS** visszajelzéssel: helyes go-nál a reakcióidő, sikeres
   gátlásnál „VISSZATARTVA”, commission-hibánál „NEM KELLETT VOLNA”.
4. **„MOST JÖN A MÉRÉS”**.
5. **MÉRÉS** — a szabály panel végig látszik, a HUD nem mutat pontszámot.
6. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Gátlási hiba (commission) | `9%` (nehéz eset `14%`) |
| Gátlási sebesség (SSRT) | `238 ms` |
| Go reakcióidő | `498 ms` (kimaradás `2%`) |
| Pályaítélet (*d′*) | `2,31` |
| Szabályváltás költsége | `18 pont` |
| Döntési fegyelem | `0,58` a pálya arányában |

Ha az `ssd_convergence` 0,15 fölött van, a második sor mellé figyelmeztetés
kerül: *„az SSRT becslése bizonytalan — a lépcső nem konvergált”*.

---

## 10/B. LÁTÓTÉR-KORLÁT

A repülések indulási azimutja **±38°**, nem több. A Quest 3 vízszintes
látótere nagyjából ±55°, tehát egy ennél szélesebb kúpból induló test az
**inger megjelenésekor fizikailag nem látszik** — csak akkor válik láthatóvá,
amikor már beljebb ért.

Ez nem kényelmi kérdés: a modul gátlást mér (go/no-go és stop-jel SSRT), és
egy meg nem jelenő inger minden reakcióidőbe becsempész egy ismeretlen
hosszúságú keresési szakaszt. Az SSRT épp ezt a reakcióidőt vonja ki, tehát a
becslés torzul.

A ±38° a teljes repülést az első képkockától a kijelzőn tartja, miközben a
modul valódi térbeli eszközét — a közeledést és a pályaítéletet — érintetlenül
hagyja. A körülnézés a WATCH konstruktuma, nem ezé.

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az 1. és 4. blokk a go/no-go paradigma prepotens
válasszal. A 2. blokk a stop-signal paradigma lépcsőzetes SSD-vel és
integrációs SSRT-becsléssel. A 3. blokk közeledő tárgyak ütközési
pályájának megítélésén alapul, ami az optikai tágulás és a diszparitás
együttes feldolgozása.

**Eltérések.** (a) A klasszikus stop-signal feladat kétválasztásos
go-feladatot használ; itt egyválasztásos, ami valamivel rövidebb go-RT-t
és így rövidebb SSRT-becslést ad — a horgonyok ehhez vannak igazítva.
(b) A közeledő inger folyamatosan változik, míg a klasszikus feladatban
az inger statikus; ez azt jelenti, hogy a go-folyamat itt nem egyetlen
pillanatban indul, hanem érik. A versenymodell feltevései így
közelítőek, és a `race_model_ok` ellenőrzés ezért kötelező.
(c) A 3. blokk nem járművezetési feladat, és nem is annak közelítése.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3):
go-RT medián 420–700 ms · commission-hiba 0,03–0,25 ·
omisszió 0–0,08 · SSRT 180–320 ms · p(respond|signal) 0,45–0,55 ·
pályaítélet *d′* 1,5–3,0 · szabályváltás-költség 0,05–0,35.
Asztali billentyűzettel a go-RT 80–150 ms-mal alacsonyabb, az **SSRT
lényegében változatlan** — ez a mutató éppen azért értékes, mert a
motoros lánc mindkét oldalról kiesik belőle.

**Az SSRT érvényességi feltételei.** Az SSRT csak akkor értelmezhető, ha
(a) p(respond|signal) 0,35 és 0,65 közé esik, és (b) a sikertelen
megállítások RT-je rövidebb a go-RT mediánjánál. A modul mindkettőt
kiszámolja és jelenti; ha bármelyik sérül, az eredmény figyelmeztetést kap.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
impulzuskontroll-zavar, alkalmatlanság fegyveres szolgálatra, sem
balesetveszélyesség.

**Tanulási hatás.** A commission-hiba 2–3 felvétel után javul és
stabilizálódik. Az **SSRT robusztus**, alig tanulható — ez teszi
longitudinálisan a legértékesebb mutatóvá. A szabályváltás hatása
ismételt felvételnél csökken, mert már nem meglepetés; a megfordítás
helye ezért seedből változik.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. Az 1. blokk go-aránya 72% ± 1 próba, és a no-go próbák fele piros
   nem pulzáló, fele kék.
2. A 2. blokkban a stopjel aránya 28% ± 1 próba.
3. Az SSD kezdőértéke 250 ms, sikeres megállítás után +50, sikertelen
   után −50, és soha nem lép ki az 50–1200 ms tartományból.
4. A stopjel csak akkor sül el, ha az SSD után legalább 300 ms marad
   a becsapódásig; ha nem, a próba go-próbaként fut és nem lépteti a lépcsőt.
5. Az SSRT integrációs módszerrel számolódik, és a számításhoz használt
   percentilis megegyezik a mért `p_respond_signal` értékkel.
6. A `race_model_ok` ellenőrzés minden futásban lefut és rögzül.
7. A 3. blokkban az ütközési és elkerülő pályák aránya 50% ± 1 próba,
   és az ütközési pálya a fej 0,35 m-es gömbjét ténylegesen metszi.
8. A menetidő 15%-a előtt érkező válasz `invalid`, és nem lépteti az SSD-t.
9. A 4. blokkban a megfordulás pontosan a 20. mért próbánál történik.
10. Két azonos seedű futás azonos ingersorrendet, pályákat és
    stopjel-elosztást ad (az SSD-lépcső a válaszoktól függ, ez rendben van).
11. Minden test forog a repülés alatt, és a forgás nem takarja el a színt
    vagy a pulzálást.
12. Mérés közben nincs semmilyen helyességre vonatkozó visszajelzés.
13. Minden `object_launched` esemény tartalmaz `quantisationMs` mezőt.
14. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
15. Szintetikus profilokon (fegyelmezett / átlagos / impulzív) az OPS
    pontszám monoton csökkenő, legalább 180 pont különbséggel.
16. Két azonos commission-hibaarányú, de eltérő SSRT-jű szintetikus profil
    közül a gyorsabb gátlású kap magasabb pontszámot.
