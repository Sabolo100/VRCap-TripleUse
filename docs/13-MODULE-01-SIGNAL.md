# 13 — MODUL 01: SIGNAL
## Vizuális keresés & anomália-észlelés — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/signal/SignalModule.ts`
**Támogatott platformok:** VR · asztali · mobil
**Névleges időtartam:** ~9 perc (gyakorlással ~11 perc)
**Doménkötés:** A elsődleges · B elsődleges · C másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a SIGNAL azt méri, milyen gyorsan és milyen megbízhatóan
emel ki valaki egy releváns ingert sok hasonló közül — és hogyan romlik ez,
ahogy nő az elemszám, ahogy a cél mozog, ahogy a cél a periférián van, vagy
ahogy a jelenet a megfigyelés két pillanata között megváltozik.

### A modul tudományos gerince: a keresési meredekség

A modul legfontosabb mutatója nem a nyers reakcióidő, hanem a **keresési
meredekség** (`search slope`): mennyivel nő a válaszidő minden további
objektummal, ms/elem egységben.

Ennek azért van kitüntetett szerepe, mert a jelenség kétféle keresést élesen
elkülönít, és a különbség maga a mérés:

- **Jellemzőkeresés** (egyetlen dimenzióban eltérő cél): a cél „kiugrik”, a
  meredekség közel nulla. A teljesítmény itt nagyrészt a szenzoros és a motoros
  láncot méri, nem a keresést.
- **Konjunkciós keresés** (a célt két jellemző *együttese* definiálja): az
  ellenőrzés soros, a meredekség jellemzően pozitív és jelentős. Ez a figyelmi
  kapacitás valódi mérése.

A kettő különbsége — `conjunction_slope − feature_slope` — személyen belüli
kontrasztként működik: kiejti az egyéni motoros sebességet és az eszközlatenciát,
mert mindkettő ugyanabban a futásban, ugyanazzal a kézzel és ugyanazon a
hardveren keletkezik. Ez teszi eszközosztályok között is értelmezhetővé,
miközben a nyers RT nem az.

A **cél-jelen / cél-nincs** próbák aránya 50–50%. Ez nem díszítés: soros
keresésnél a „nincs cél” próbák meredeksége elméletileg a „van cél” próbákénak
körülbelül kétszerese (a teljes halmazt át kell nézni, nem átlagosan a felét).
A két meredekség aránya (`absent_present_slope_ratio`) így belső
érvényességi ellenőrzés — ha 1 közelébe esik, a résztvevő nem keresett, hanem
találgatott.

### Mért konstruktumok

| Konstruktum | Katalógus # | Blokk | Paradigma |
|---|---|---|---|
| Vizuális keresés | 16 | 1, 2 | Feature/conjunction search |
| Szelektív figyelem | 22 | 2, 5 | Konjunkciós keresés, kettős feladat |
| Mintázatfelismerés | 7 | 1, 2 | — |
| Célkövetés több objektumon | 36 | 3 | Multiple Object Tracking |
| Változásészlelés | 18 | 4 | Change detection, üres képkocka |
| Perifériás észlelés | 17 | 5 | Peripheral detection task |
| Pásztázási hatékonyság | 135 | 1, 2, 5 | Fejirány-eloszlás (csak VR) |
| Fenyegetés-észlelés | 45 | 1–5 | absztrakt megfelelő |

### Amit a modul NEM mér

- **Nem méri a látásélességet és a színlátást.** A célok szándékosan jóval a
  küszöb felett vannak. Aki nem látja őket, annak szemészeti vizsgálat kell,
  nem ez a modul. A 89–90. katalógustétel kizárva marad.
- **Nem méri a tartós figyelmet.** A blokkok 60–120 másodpercesek; az
  éberség-lejtés a WATCH (06) dolga. Aki itt jól teljesít, arról nem tudjuk,
  negyven perc után is jól teljesítene-e.
- **Nem méri a valódi fenyegetés-felismerést.** A célok absztrakt geometriai
  alakzatok. A tartalmi tudás (mi számít fenyegetésnek) tanult és
  domén-specifikus; ez a modul az alatta lévő keresési gépezetet méri.
- **Nem szemmozgás-mérés.** A Quest 3-ban nincs szemkövetés. A pásztázási
  metrikák **fejirányból** számolnak, és a nevük ezt ki is mondja
  (`head_scan_*`). Fejirányból tekintetre következtetni hiba lenne: a szem a
  fejhez képest ±30°-ot mozog anélkül, hogy a fej elfordulna.
- **Nem különíti el a UFOV-t.** Az 5. blokk perifériás *detekciós* RT-t mér
  központi terhelés mellett; a hasznos látómező küszöbmérése a FIELD (12) modul
  feladata, rövid expozícióval és lokalizációval.

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** Megfigyelői, felderítő, szenzoroperátori és
őrszolgálati feladatok magja: zajos háttérből kiemelni a releváns keveset,
mielőtt az számítana. A konjunkciós meredekség itt a legbeszédesebb: a valós
felderítési feladat szinte soha nem pop-out („piros pont a zöldek között”),
hanem konjunkció („ez a jármű ezen az útszakaszon, ebben az időben”).
A 4. blokk (változásészlelés) közvetlenül a felderítő képösszehasonlítás
absztrakt megfelelője. Beosztások: felderítő, drónkezelő, képelemző,
szenzoroperátor, őr.

**B — Munkaalkalmasság (elsődleges).** Radarkép, műszerfal, gyártósor,
röntgenfelvétel — ugyanaz a keresési gépezet dönti el, hogy a ritka eltérés
feltűnik-e időben. A false alarm arány itt legalább olyan fontos, mint a hit
rate: aki mindent gyanúsnak talál, ugyanúgy használhatatlan, mint aki semmit.
Ezért a modul jelészlelés-elméleti mutatót (*d′* és *kritérium*) is számol.
Munkakörök: légiirányító, radiológiai asszisztens, minőségellenőr,
biztonsági szkenner-operátor.

**C — Sport (másodlagos).** A 3. blokk (több objektum követése) a
csapatsportbeli „látja a pályát” képesség legjobban dokumentált laboratóriumi
megfelelője: több mozgó ember egyidejű nyomon követése hasonló mozgó
ingerek között. Sportágak: labdarúgás, kosárlabda, vízilabda, jégkorong.

---

## 3. FELADATSTRUKTÚRA

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | JELLEMZŐKERESÉS | 4 | 24 | ~1:30 | pop-out, szenzoros + motoros alapvonal |
| 2 | KONJUNKCIÓS KERESÉS | 4 | 30 | ~2:40 | soros figyelmi ellenőrzés |
| 3 | KÖVETÉS | 2 | 12 | ~2:20 | többobjektumos követési kapacitás |
| 4 | VÁLTOZÁS | 3 | 18 | ~1:50 | vizuális rövid távú memória, változásészlelés |
| 5 | PERIFÉRIA | 4 | 30 | ~1:40 | perifériás detekció központi terhelés alatt |

### 3.1. Blokk 1 — Jellemzőkeresés (pop-out)

A felhasználó előtt egy gömbhéjon elhelyezett objektumtömb jelenik meg.
Minden objektum azonos alakú (kocka) és azonos színű (semleges kék), **kivéve**
a célt, amely egyetlen dimenzióban tér el: **borostyánsárga**.

- **Elemszám:** 6 / 12 / 24, próbánként véletlenszerűen, egyenlő arányban
  (mért blokkban 8-8-8).
- **Cél jelen:** a próbák 50%-ában.
- **Válasz:** mutass a célra és erősítsd meg; ha nincs cél, a tömb alatti
  **NINCS CÉL** panelgombot használd.

```
PREPARE          600–1100 ms   üres tér, központi fixációs pont
COUNTDOWN        0
STIMULUS         max 8000 ms   a tömb megjelenik, válaszra vár
RESPONSE         0
FEEDBACK         600 ms gyakorláskor, 0 mérés közben
INTER-TRIAL      350 ms
```

**Miért van fixációs pont a PREPARE alatt?** Mert enélkül a résztvevő ott
kezdene keresni, ahol az előző cél volt, és a keresési idő az előző próba
geometriájától függene. A fixációs pont minden próbát ugyanabból a
kiindulásból indít.

### 3.2. Blokk 2 — Konjunkciós keresés

Ugyanaz a geometria, de a célt **két jellemző együttese** definiálja:
a cél a **borostyánsárga kocka**. A disztraktorok: borostyánsárga gömbök és
kék kockák, körülbelül fele-fele arányban. Egyik jellemző sem elég a
megtaláláshoz, tehát a keresés soros lesz.

- **Elemszám:** 6 / 12 / 24, mért blokkban 10-10-10.
- **Cél jelen:** 50%.
- **Válasz:** azonos az 1. blokkal.
- **Válaszablak:** max 12 000 ms (a soros keresés lassabb).

### 3.3. Blokk 3 — Követés (Multiple Object Tracking)

Tíz azonos gömb lebeg a látómezőben. A próba elején **3 vagy 4** gömb
felvillan (2000 ms) — ezek a célok. Ezután minden gömb azonos színűvé válik,
és 8000 ms-ig véletlen, sima pályán mozognak (korlátos véletlen bolyongás,
0,22 m/s, egymáson nem haladnak át). Megállás után a felhasználónak ki kell
választania a célokat.

- **Célszám:** 3 (6 próba) vagy 4 (6 próba), keverve.
- **Válasz:** annyi gömbre kell mutatni és megerősíteni, ahány cél volt;
  a kiválasztott gömb kiemelést kap, és újra rákattintva visszavonható.
  A blokk automatikusan tovább lép, ha megvan a kellő számú kijelölés,
  és a felhasználó megnyomja a **KÉSZ** gombot.

**Miért ez a mérés?** A követési kapacitás nem azonos a figyelmi kapacitással
általában, de a legjobban validált mérőszáma annak, hány mozgó objektumot tud
valaki egyidejűleg nyomon követni — pontosan az a képesség, ami egy
szenzoroperátornak vagy egy csapatjátékosnak kell.

### 3.4. Blokk 4 — Változásészlelés

Egy 8 elemű jelenet 1200 ms-ig látszik, majd **250 ms üres képkocka**
(minden objektum eltűnik), majd a jelenet visszatér, és **egy** objektum
megváltozott. A feladat a megváltozott objektum megjelölése.

- **Változás típusa:** szín (40%), méret (30%), pozícióeltolás (30%).
- **A változás mértéke** minden típusnál jóval küszöb feletti: szín ≥ 90°
  színkörön, méret ±45%, pozíció ≥ 5° szögeltolás.
- **A ciklus ismétlődik** (jelenet → üres → módosított jelenet → üres → …),
  amíg a felhasználó nem válaszol vagy le nem jár a 15 000 ms.

**Miért kell az üres képkocka?** Enélkül a változás mozgásjelzést kelt, amit a
perifériás látás automatikusan elkap — akkor a feladat nem változásészlelés
lenne, hanem mozgásdetekció. Az üres kocka az összes lokális mozgásjelzést
egyszerre kelti, ezért használhatatlanná teszi őket; ez a klasszikus
„flicker” eljárás lényege.

### 3.5. Blokk 5 — Periféria központi terhelés alatt

Kettős feladat.

- **Központi feladat (folyamatos):** egy kis korong lassan sodródik a
  látómező közepe körül (±4°, 0,08 m/s); a mutatót rajta kell tartani.
  Ez köti le a központi figyelmet, és mérjük a rajta töltött időt.
- **Perifériás feladat (diszkrét):** véletlen időközönként (2200–5200 ms)
  rövid felvillanás jelenik meg a periférián, **15° / 30° / 45°**
  excentricitáson, véletlen irányban. A felvillanás 220 ms hosszú.
  Erre `PRIMARY` akcióval kell reagálni, a lehető leggyorsabban.
- **Fogások:** a próbák 20%-ában nincs felvillanás (üres próba), így a
  téves riasztás mérhető.

**A perifériás inger nem igényel fejfordítást** 45°-ig — a Quest 3 látómezeje
ennél lényegesen szélesebb. Ez szándékos: a mérés a perifériás észlelést
célozza, nem a fejfordítás sebességét.

---

## 4. INGERDEFINÍCIÓ

Minden objektum a felhasználó körüli **2,4 m sugarú gömbhéjon** ül,
a fej magasságában központozva.

| Elem | Geometria | Méret | Szögméret 2,4 m-ről | Szín |
|---|---|---|---|---|
| Disztraktor kocka | box | 0,16 m | 3,8° | `#3D7BB8` (semleges kék) |
| Disztraktor gömb | sphere | 0,17 m | 4,1° | `#3D7BB8` / `#FF9E1B` |
| Cél (1. blokk) | box | 0,16 m | 3,8° | `#FF9E1B` |
| Cél (2. blokk) | box | 0,16 m | 3,8° | `#FF9E1B` |
| MOT gömb | sphere | 0,20 m | 4,8° | `#8FA6BF`, célvillanáskor `#FF9E1B` |
| Változásjelenet elem | box/sphere/cone vegyesen | 0,18 m | 4,3° | 5 elemű paletta |
| Központi korong (5.) | ring | 0,09 m | 2,1° | arculati kiemelő |
| Perifériás felvillanás | sphere | 0,13 m | 3,1° | `#FFFFFF`, emissziós |
| Fixációs pont | sphere | 0,04 m | 1,0° | `#5C6B7D` |

**Elhelyezés.** Az objektumok **rácsjitteres** mintát követnek: a látómezőt
cellákra osztjuk, és minden objektum a saját cellája közepétől ±35%-nyit tér
el véletlenszerűen. Tisztán véletlen elhelyezésnél előfordulnának
összecsomósodások és üres sávok, amelyek a keresést kiszámíthatatlanul
könnyítenék vagy nehezítenék, és a keresési meredekség zajossá válna.

**Minimális szögtávolság** két objektum között 6°, hogy a mutatás
egyértelmű legyen és a laterális maszkolás ne befolyásolja a detekciót.

**Hang.** A tömb megjelenésekor 1400 Hz-es kattanás (28 ms). A perifériás
felvillanáshoz **nem** tartozik hang — hangjelzés esetén a feladat auditív
detekcióvá válna. Gyakorlás közben helyes válaszra 880 Hz, hibásra
180→120 Hz lefutó négyszög.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1 Jellemzőkeresés | `adapted` | A tömb szögkiterjedése a viewporthoz igazodik. |
| 2 Konjunkciós | `adapted` | Ugyanaz. |
| 3 Követés | `adapted` | A mozgástér amplitúdója a viewporthoz igazodik. |
| 4 Változás | `adapted` | A jelenet szögkiterjedése igazodik. |
| 5 Periféria | `adapted` | Az excentricitások lapos képernyőn fizikailag korlátosak. |

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Tömb azimut | ±55° | ±26° | ±20° |
| Tömb elevatio | ±25° | ±14° | ±13° |
| Objektum szögméret | 3,8° | 3,8° | 5,0° |
| Minimális szögtávolság | 6,0° | 5,0° | 6,0° |
| MOT mozgástér | ±38° × ±20° | ±22° × ±12° | ±17° × ±11° |
| Perifériás excentricitások | 15° / 30° / 45° | 10° / 17° / 24° | 8° / 13° / 18° |
| Elemszámok | 6 / 12 / 24 | 6 / 12 / 24 | 6 / 12 / 24 |

**Az elemszám minden platformon azonos marad**, mert a keresési meredekség
az elemszám függvénye; ha ez változna, a meredekség platformok között
összehasonlíthatatlanná válna. A *szögsűrűség* viszont eltér — ezt a trial
rekord `arrayExtentDeg` mezője rögzíti.

### Platformonként kieső metrikák

| Metrika | VR | Asztali | Mobil |
|---|---|---|---|
| `head_scan_range` / `head_scan_entropy` | ✓ | **kiesik** | **kiesik** |
| `pointer_scan_range` | ✓ | ✓ | csak lenyomás közben |
| `central_time_on_target` (5. blokk) | ✓ | ✓ | csak lenyomás közben |
| minden keresési meredekség | ✓ | ✓ | ✓ |

### Irányítási szöveg platformonként

| Blokk | VR | Asztali | Mobil |
|---|---|---|---|
| 1–2 | „Irányítsd a sugarat a célra és húzd meg a ravaszt. Ha nincs cél, a NINCS CÉL gombot használd.” | „Kattints a célra. Ha nincs cél, a NINCS CÉL gombra.” | „Koppints a célra. Ha nincs cél, a NINCS CÉL gombra.” |
| 3 | „Jelöld ki a ravasszal azokat a gömböket, amelyek az elején felvillantak, majd KÉSZ.” | „Kattints a felvillant gömbökre, majd KÉSZ.” | „Koppints a felvillant gömbökre, majd KÉSZ.” |
| 4 | „Mutass arra az objektumra, amelyik megváltozott.” | „Kattints arra, amelyik megváltozott.” | „Koppints arra, amelyik megváltozott.” |
| 5 | „Tartsd a sugarat a középső gyűrűn, és húzd meg a ravaszt, amint a periférián felvillan valami.” | „Kövesd az egérrel a középső gyűrűt, és nyomj SZÓKÖZT, amint felvillan valami.” | „Tartsd az ujjad a középső gyűrűn, és koppints a másik ujjaddal, amint felvillan valami.” |

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

A feladatot nehezíti: az elemszám, a cél és a disztraktor közti hasonlóság,
a disztraktorok heterogenitása, a MOT-nál a célszám és a mozgási sebesség,
a változásészlelésnél az üres kocka hossza, a perifériánál az excentricitás
és a központi terhelés.

### `SIGNAL_STANDARD_A` (alapértelmezés)

```
featureTrials       24   setSizes [6,12,24]  targetPresent 0.5
conjunctionTrials   30   setSizes [6,12,24]  targetPresent 0.5
motTrials           12   targets [3,4]  trackMs 8000  speed 0.22
changeTrials        18   sceneSize 8  blankMs 250  viewMs 1200
peripheralTrials    30   ecc [15,30,45]  flashMs 220  catchRate 0.2
```

### `SIGNAL_SHORT` (~4,5 perc, szűrésre)

```
featureTrials       12   conjunctionTrials 15   motTrials 6
changeTrials        10   peripheralTrials 16
```

### CHALLENGE mód

Az elemszám 32-ig nő, a MOT célszám 5-ig, a változásészlelésnél a
változás mértéke a küszöb közelébe csökken, és van élő pontszám.
**A CHALLENGE eredmény soha nem kerül ugyanabba a normacsoportba az
assessment eredménnyel**, mert az adaptív nehézség miatt a meredekségek
nem összevethetők.

---

## 7. METRIKÁK

### Nyers (próbánként)
`setSize` · `targetPresent` · `responseType` (`located` / `absent`) ·
`correct` · `reactionTimeMs` · `localisationErrorDeg` · `arrayExtentDeg` ·
`changeType` · `changeIndex` · `motTargets` · `motSelected` ·
`eccentricityDeg` · `catchTrial`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `feature_slope` | A helyes, cél-jelen próbák RT-jének regressziós meredeksége az elemszám ellen (ms/elem) |
| `conjunction_slope` | Ugyanaz a 2. blokkban |
| `search_slope_difference` | `conjunction_slope − feature_slope` — a személyen belüli kontraszt |
| `feature_intercept` / `conjunction_intercept` | A regresszió tengelymetszete: a keresésen kívüli idő (ms) |
| `absent_present_slope_ratio` | Cél-nincs meredekség / cél-jelen meredekség; soros keresésnél ~2 várható |
| `search_hit_rate` | Helyes „megtaláltam” / összes cél-jelen próba |
| `search_false_alarm_rate` | „Megtaláltam” cél-nincs próbán / összes cél-nincs próba |
| `search_d_prime` | *d′* = z(hit) − z(FA), 0,5/n korrekcióval a szélsőértékekre |
| `search_criterion` | *c* = −0,5 · (z(hit) + z(FA)); pozitív = konzervatív |
| `median_search_time` | Medián RT a helyes, cél-jelen próbákon, minden elemszámra összevonva |
| `localisation_error_median` | Medián szögtávolság a megerősítés helye és a cél középpontja között |
| `mot_accuracy` | Helyesen azonosított célok / összes cél a 3. blokkban |
| `mot_capacity_k` | Pashler–Cowan *k* = N · (hit rate − false alarm rate) / (1 − FA), célszámonként átlagolva |
| `change_accuracy` | Helyesen megjelölt változások aránya |
| `change_detection_time` | Medián idő az első módosított jelenet megjelenésétől a válaszig |
| `change_cycles_needed` | Medián ismétlési ciklusszám a válaszig |
| `peripheral_hit_rate_15/30/45` | Detekciós arány excentricitásonként |
| `peripheral_rt_median` | Medián perifériás detekciós RT |
| `peripheral_eccentricity_cost` | A hit rate regressziós meredeksége az excentricitás ellen (%/fok) |
| `peripheral_false_alarms` | Válaszok üres próbákon |
| `central_time_on_target` | Az 5. blokkban a központi korongon töltött idő aránya |
| `head_scan_range` | A fejirány azimut 5–95 percentilis tartománya (fok), csak VR |
| `head_scan_entropy` | A fejirány-eloszlás Shannon-entrópiája 10°-os rekeszeken, normalizálva |

**A *d′* számításáról.** Nulla vagy 100%-os arányoknál a z-transzformáció
végtelenbe fut. A szokásos log-lineáris korrekciót alkalmazzuk (minden
cellához +0,5 hozzáadva, a nevezőhöz +1), ami kis mintánál a legkevésbé
torzító megoldás. A korrekció ténye a metrika mellett tárolódik.

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `search_efficiency` | konjunkciós meredekség 12 ms/elem | 90 ms/elem | Konjunkciós keresés tipikus tartománya; **provizórikus**, saját normára kalibrálandó |
| `search_accuracy` | *d′* = 4,0 | *d′* = 0,8 | Jelészlelés-elméleti tartomány |
| `tracking_capacity` | *k* = 4,0 | *k* = 1,2 | MOT kapacitás tipikus felnőtt tartománya |
| `change_sensitivity` | 95% pontosság | 35% | 8 elemből véletlen találat 12,5% |
| `peripheral_awareness` | 95% hit 45°-on | 40% | **Provizórikus** |
| `search_speed` | medián 900 ms | 4200 ms | Konjunkciós keresés 12 elemnél |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Keresési hatékonyság (meredekség) | 0,26 |
| Keresési pontosság (*d′*) | 0,22 |
| Követési kapacitás | 0,18 |
| Változásérzékenység | 0,14 |
| Perifériás észlelés | 0,12 |
| Keresési sebesség | 0,08 |

A meredekség kapja a legnagyobb súlyt, mert az a legkevésbé eszközfüggő és a
legjobban a vizsgált konstruktumhoz kötött mutató.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `array_onset` | block, setSize, targetPresent, targetIndex, arrayExtentDeg, quantisationMs |
| `search_response` | responseType, correct, rtMs, localisationErrorDeg, setSize |
| `mot_targets_shown` | targetCount, indices |
| `mot_motion_start` / `mot_motion_end` | trial, speed, durationMs |
| `mot_selection` | index, selected (be/ki), elapsedMs |
| `mot_submitted` | selected[], correctCount |
| `change_scene_shown` | sceneSize, cycle |
| `change_applied` | changeType, index, magnitude |
| `change_response` | correct, index, cycles, rtMs |
| `peripheral_flash` | eccentricityDeg, azimuthDeg, catchTrial |
| `peripheral_response` | rtMs, hit, eccentricityDeg |
| `central_sample` | onTarget, errDeg — minden 6. frame |
| `head_sample` | yawDeg, pitchDeg — minden 10. frame, csak VR |

**Mozgásnaplózás: 20 Hz.** A keresésnél a fejpálya valódi metrika
(pásztázási lefedettség), de nem szükséges a REACT 30 Hz-es felbontása,
mert itt nincs ezredmásodperces mozdulatindítás-mérés. Egy 9 perces futás
így kb. 10 800 minta.

---

## 9. ADATBÁZIS

Új tábla nem kell. A `trials.stimulus` blokkonként:

```jsonc
// feature / conjunction
{ "kind": "search", "mode": "feature", "setSize": 12, "targetPresent": true,
  "targetAzDeg": -21.4, "targetElDeg": 8.2, "arrayExtentDeg": 55, "platform": "vr" }
// mot
{ "kind": "mot", "targetCount": 4, "targetIndices": [1,4,7,9], "speed": 0.22, "trackMs": 8000 }
// change
{ "kind": "change", "sceneSize": 8, "changeType": "color", "changeIndex": 3, "blankMs": 250 }
// peripheral
{ "kind": "peripheral", "eccentricityDeg": 30, "azimuthDeg": 142, "catchTrial": false }
```

A `trials.response`:

```jsonc
{ "rtMs": 1840.2, "responseType": "located", "localisationErrorDeg": 1.9,
  "selectedIndices": [1,4,7,9], "correctCount": 3, "cycles": 2 }
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „SIGNAL / Vizuális keresés & anomália-észlelés”, az öt blokk
   listája próbaszámokkal.
2. **INSTRUKCIÓ** blokkonként, kiemelt IRÁNYÍTÁS dobozzal.
3. **GYAKORLÁS** visszajelzéssel: helyes találatnál a keresési idő, hibásnál
   „HIBÁS”, kimaradtnál „KIMARADT”, téves riasztásnál „NINCS OTT CÉL”.
4. **„MOST JÖN A MÉRÉS”**.
5. **MÉRÉS** — az információs panel eltűnik.
6. **FELDOLGOZÁS**.
7. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Keresési meredekség (konjunkció) | `38 ms/elem` (jellemző: `4 ms/elem`) |
| Keresési pontosság (*d′*) | `3,1` |
| Követési kapacitás | `3,4 objektum` |
| Változásészlelés | `78%` (`2,1` ciklus) |
| Perifériás detekció 45°-on | `81%` (`412 ms`) |
| Téves riasztás | `2 / 27` |

---

### Mobil vezérlés

| Blokk | Mobil megoldás |
|---|---|
| 1–2 Keresés | koppintás a célra · **NINCS CÉL** gomb a képernyő alján |
| 3 Követés | koppintás a felvillant gömbökre · **KÉSZ** gomb |
| 4 Változás | koppintás a változó objektumra |
| 5 Periféria | **VILLANÁS** gomb — a koppintás nem lehet válasz, mert az a központi feladat felülete |

A „nincs cél" korábban a tömb alá helyezett 3D panel volt. Telefonon a
látószög szűkítése után az ingerek elé került, és kitakarta a keresett célt;
DOM-gombként ez nem fordulhat elő. A gombsáv a vetítési ablakot is feljebb
tolja (`Engine.setViewportBottomInset`), így a tömb legalsó sora sem kerül
elérhetetlen helyre.

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az 1–2. blokk a jellemző- és konjunkciós keresés klasszikus
elrendezését követi, cél-jelen/cél-nincs kiegyensúlyozással. A 3. blokk a
Multiple Object Tracking paradigma. A 4. blokk a „flicker” változásészlelési
eljárás. Az 5. blokk a járművezetési kutatásból ismert perifériás detekciós
feladat szerkezete.

**Eltérések az eredeti paradigmáktól.** (a) A klasszikus elrendezések 2D
képernyőn, fix fejjel futnak; itt a fej mozoghat, ami VR-ben a keresést
természetesebbé, de a szigorú excentricitás-kontrollt gyengébbé teszi.
Ezt a fejirány-naplózás teszi utólag elemezhetővé. (b) A válasz itt
lokalizáció (mutatás), nem kétválasztásos gombnyomás; ez motoros komponenst
ad az RT-hez, ami a meredekségből kiesik, de az abszolút RT-t növeli.
(c) A MOT-ban az objektumok 3D-ben mozognak, ami mélységi jelzést ad —
ez könnyítheti a követést a 2D változathoz képest.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3, kontroller):
jellemzőmeredekség 0–8 ms/elem · konjunkciós meredekség 20–60 ms/elem ·
*d′* 2,5–4,0 · MOT *k* 2,5–4,0 · változásészlelés 65–90%, 1,5–4 ciklus ·
perifériás hit rate 45°-on 70–95%. Asztali egérrel a meredekségek hasonlóak,
az abszolút RT-k 200–500 ms-mal alacsonyabbak.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
alkalmasság megfigyelői beosztásra, figyelemzavar, sem sportági
tehetség. A modul egy laboratóriumi képességet mér, amelynek a valós
feladatra való átvitele külön validációs kérdés.

**Tanulási hatás.** A keresési meredekség 2–3 felvétel után stabilizálódik;
az abszolút RT tovább javul (eszközhasználati tanulás). A MOT-kapacitás
robusztus, alig tanulható. A változásészlelés **erősen tanulható**, ha
ugyanaz a jelenetkészlet ismétlődik — ezért a jelenetek seedből
generálódnak, és ismételt felvételnél kötelező más seed.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. Minden keresési próbában pontosan 6, 12 vagy 24 objektum jelenik meg,
   és cél-jelen próbán pontosan egy cél.
2. A cél-jelen és cél-nincs próbák aránya blokkonként 50% ± 1 próba.
3. Két objektum szögtávolsága soha nem kisebb a konfigurált minimumnál.
4. Két azonos seedű futás azonos elemszám-, pozíció- és színsorozatot ad.
5. A „NINCS CÉL” gomb megnyomása cél-jelen próbán `miss` kimenetet ad,
   cél-nincs próbán `correct_reject`-et.
6. Cél-nincs próbán bármely objektumra való mutatás `false_alarm`.
7. A *d′* számítás log-lineáris korrekciót alkalmaz, és soha nem ad
   végtelen vagy `NaN` értéket.
8. A MOT blokkban a gömbök nem hagyják el a mozgásteret, és nem fedik át
   egymást 2°-nál közelebb.
9. A MOT válasz csak akkor küldhető be, ha pontosan annyi gömb van
   kijelölve, ahány cél volt.
10. A változásészlelésnél az üres képkocka minden ciklusban 250 ms, és
    ezalatt egyetlen objektum sem látszik.
11. A perifériás blokkban az üres (catch) próbák aránya 20% ± 1 próba, és a
    rájuk adott válasz `false_alarm`-ként rögzül.
12. Asztali módban minden objektum a viewporton belülre esik
    (|azimut| ≤ 26°, |elevatio| ≤ 14°).
13. Minden `array_onset` esemény tartalmaz `quantisationMs` mezőt.
14. A modul kilépéskor minden létrehozott 3D objektumot és panelt felszabadít.
15. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
16. Szintetikus profilokon (jó / átlagos / gyenge kereső) az OPS pontszám
    monoton csökkenő, legalább 180 pont különbséggel a szélsők között.

---

# B VÁLTOZAT — TÉRFOGATI KERESÉS (`SIGNAL_SPATIAL_B`)

Ez a fejezet a modul **B változatát** írja le. Az A változat (a dokumentum
1–12. fejezete) változatlanul marad és továbbra is futtatható; a két változat
külön `config_version`-nel megy az adatbázisba, ezért a normacsoportjaik
soha nem keverednek. A választás a felhasználóé, a modulkártya A / B gombjaival.

## B/1. Miért van B változat

Az A változat vizuális keresése egy homlokfelületre kivetett elrendezésen zajlik.
A `docs/03-SPATIAL-DESIGN.md` laposítási tesztjén ez megbukik: ha a teljes jelenetet
egyetlen, a felhasználó előtti gömbhéjra lapítanánk, **egyetlen metrika sem változna**.
A keresés ekkor 2D keresés, amit egy monitor is elvégez — a VR csak megjelenítő.

A B változat azt a három dolgot méri, amit a lapos elrendezés szerkezetileg nem tud:

| Kérdés | Csak térben mérhető, mert |
|---|---|
| Tudja-e a résztvevő a **mélységet keresési szűrőként** használni? | ehhez a tárgyaknak valóban különböző távolságban kell lenniük |
| Mi a **fordulás ára**, ha a cél mögötte van? | a 360°-os elrendezés fejmozgást kényszerít, a lapos nem |
| Túléli-e a követés, ha a tárgyak **egymás mögé kerülnek**? | takarás csak akkor keletkezik, ha van mélységi sorrend |

## B/2. Térbeliség — a modul létjogosultsága

**Laposítási kérdés:** ha a jelenetet egy héjra lapítjuk, a
`depth_guidance_benefit`, a `rotation_search_cost`, a `rear_search_time`,
az `occlusion_tracking_cost` és a `depth_change_cost` mind értelmezhetetlenné válik.
Öt metrika esik ki, ebből három az OPS 44%-át adja. A modul tehát térbeli.

Használt affordanciák (a hat közül négy):

| Affordancia | Metrika, amit ad |
|---|---|
| **Surround** — 360° | `rotation_search_cost`, `rear_search_time`, `head_scan_range`, `head_scan_entropy` |
| **Depth** — önálló csatorna | `search_slope_depth_cued`, `depth_guidance_benefit`, `depth_change_cost` |
| **Rotation / szilárd testek** | a cél kocka, a disztraktor gömb: a forma nézőpontfüggetlen, a sziluett nem |
| **Hidden transform** | takarás alatt is folytatódó objektumazonosság (MOT blokk) |

**Szögméret-kompenzáció.** A három mélységi réteg 2,2 / 3,6 / 5,4 m-en van (VR).
Az objektumok fizikai mérete rétegenként a távolsággal arányosan nő, így a
**szögméretük azonos** — a mélységet kizárólag a binokuláris diszparitás és a
mozgásparallaxis hordozza. E nélkül a „mélységi keresés” valójában méret szerinti
keresés lenne, azaz a lapos eset álruhában.

## B/3. Feladatstruktúra

| # | Blokk | Próba | Gyakorlás | Cél |
|---|---|---|---|---|
| 1 | `depth` — MÉLYSÉGI KERESÉS | 30 | 4 | keresési meredekség rétegjelzés nélkül és azzal |
| 2 | `surround` — KÖRKÖRÖS KERESÉS | 24 | 4 | a fordulás ára, hátsó vs. elülső féltér |
| 3 | `occlusion` — KÖVETÉS TAKARÁSSAL | 12 | 2 | MOT sugárirányú sebességgel, azaz takarással |
| 4 | `depthchange` — MÉLYSÉGI VÁLTOZÁS | 18 | 3 | flicker change detection, ahol a változás rétegváltás is lehet |

**1. blokk.** Konjunkciós keresés (narancs kocka a narancs gömbök és kék kockák között),
halmazméret 8 / 16 / 24, három rétegre szétosztva. A próbák **felében** a rendszer
előre megmondja, melyik rétegben van a cél. A két feltétel keresési meredekségének
különbsége a `depth_guidance_benefit`: pozitív érték azt jelenti, hogy a résztvevő
a mélységi információt tényleg szűrőnek használta, nem csak nézte.

**2. blokk.** Azonos feladat, de 180°-os azimutális kiterjedésben (VR), tehát a célok
harmada a fej kiindulási irányán kívülre esik. A keresési idő a cél kezdeti
excentricitásának függvényében regresszálva adja a `rotation_search_cost`-ot (ms/fok).

**3. blokk.** 8 gömb, ebből 3–4 megjelölt, 8 s mozgás. A sebességvektornak
**sugárirányú komponense is van**, ezért a gömbök áthaladnak egymás előtt.
Próbánként naplózzuk a tényleges takarási események számát (`mean_occlusion_events`),
és a takarásszám függvényében esik-e a pontosság (`occlusion_tracking_cost`).

**4. blokk.** Flicker-paradigma (250 ms jelenet / 80 ms üres). A változás a próbák
kb. felében **rétegváltás**, szögméret-kompenzációval — vagyis a tárgy pontosan
ugyanakkorának látszik, csak közelebb kerül. Ez az a változás, amit a lapos verzió
egyáltalán nem tud előállítani.

## B/4. Ingerdefiníció

Csak primitívek: **gömb** (disztraktor és MOT-elem), **kocka** (cél), **gyűrű**
(MOT-jelölés), **sík** (panelek). A jelenetgeometria platformonként:

| Platform | Azimut | Elevációs sáv | Közeli / távoli sugár | Min. szeparáció |
|---|---|---|---|---|
| VR, `depth` | ±52° | −20°…+24° | 2,2 / 5,4 m | 8° |
| VR, `surround` | ±180° | −16°…+24° | 2,6 / 5,4 m | 9° |
| Desktop | ±25° | −13°…+14° | 2,4 / 4,2 m | 6° |
| Mobil | ±19° | −11°…+12° | 2,4 / 4,2 m | 7° |

A minimális szögszeparáció azt garantálja, hogy a keresés ne váljon zsúfoltság
(crowding) által limitálttá — a mért mennyiség a keresés, nem a felbontás.

## B/5. Keresztplatform leképezés

| Elem | VR | Desktop | Mobil | Besorolás |
|---|---|---|---|---|
| Cél kijelölése | kontrollersugár + ravasz | egérkattintás | koppintás | `equivalent` |
| „nincs cél” | B gomb | Szóköz | „NINCS CÉL” gomb | `equivalent` |
| Mélységi rétegek | 2,2–5,4 m, diszparitás + parallaxis | 2,4–4,2 m, csak parallaxis | ua. | `adapted` |
| Körkörös keresés | 360°, fejfordulás | 50° FOV, nincs hátsó féltér | ua. | **`vr-only`** |
| Fejpásztázás naplózása | 30 Hz | — | — | **`vr-only`** |

Lapos platformon **kiesik**: `rotation_search_cost`, `rear_search_time`,
`front_search_time`, `head_scan_range`, `head_scan_entropy`. A `surround_search`
score súlya ilyenkor **0**, a maradék öt súly arányosan felskálázódik, és az
eredményképernyő kiírja, hogy egy összetevő nem volt mérhető. Nem becsüljük,
nem helyettesítjük — hiányzik.

`controlHint` szövegek: VR „RAVASZ: cél kijelölése · B: nincs cél”,
desktop „BAL EGÉRGOMB: cél · SZÓKÖZ: nincs cél”, mobil „KOPPINTÁS: cél · gomb: nincs cél”.

## B/6. Metrikák

**Nyers (próbánként):** halmazméret, rétegindex, `depthCued`, cél jelen/nincs,
válaszidő, találat/tévesztés, a fej azimutja a próba kezdetén és a válasz pillanatában.

**Származtatott (kiemelve):**

| Metrika | Definíció | Egység |
|---|---|---|
| `search_slope_uncued` | a keresési idő regressziós meredeksége a halmazméretre, rétegjelzés nélkül, a helyes „cél jelen” próbákon | ms/elem |
| `search_slope_depth_cued` | ugyanaz, rétegjelzéssel | ms/elem |
| `depth_guidance_benefit` | `search_slope_uncued − search_slope_depth_cued` | ms/elem |
| `rotation_search_cost` | a keresési idő meredeksége a cél kezdeti excentricitására | ms/fok |
| `occlusion_tracking_cost` | a MOT-pontosság esése a sok takarású és a kevés takarású próbák között | arány |
| `depth_change_cost` | `change_accuracy_surface − change_accuracy_depth` | arány |
| `head_scan_entropy` | a fejazimut eloszlásának normalizált entrópiája 12 binben | 0–1 |

**OPS SCORE összetevők:**

| Összetevő | Súly (VR) | Súly (lapos) |
|---|---|---|
| `search_efficiency` | 0,22 | 0,25 |
| `depth_guidance` | 0,18 | 0,205 |
| `search_accuracy` | 0,18 | 0,205 |
| `tracking_capacity` | 0,16 | 0,18 |
| `occlusion_resilience` | 0,14 | 0,16 |
| `surround_search` | 0,12 | **0** |

## B/7. Validáció és korlátok

**Származás.** Treisman konjunkciós keresése; a mélységi vezérlés Nakayama és
Silverman sztereo-keresési eredményeire épül (a diszparitás keresési szűrőként
működik); a MOT Pylyshyn és Storm paradigmája, radiális mozgással kiegészítve;
a change detection Rensink flicker-eljárása.

**Eltérés.** A klasszikus sztereo-keresési kísérletek két diszparitássíkot
használnak; itt három van, és a szögméret kompenzált, ami szigorúbb: a mélységi
előny nem magyarázható méretkülönbséggel.

**Elvárt nagyságrend** egészséges felnőttnél VR-ben: `search_slope_uncued`
25–60 ms/elem, `depth_guidance_benefit` 8–25 ms/elem, `mot_accuracy` 3 célnál
0,75–0,92, `depth_change_cost` 0,05–0,15.

**Amit nem szabad kikövetkeztetni:** sztereolátás klinikai minősítését. Aki
gyenge `depth_guidance_benefit`-et ér el, lehet, hogy nem használja a mélységet,
de lehet, hogy nem is látja — ezt a modul nem különbözteti meg. Sztereovakság
gyanúja esetén a B változat eredménye nem értelmezhető.

## B/8. Elfogadási kritériumok

1. A három mélységi réteg objektumainak szögmérete legfeljebb 3%-kal tér el.
2. A `depth` blokk próbáinak pontosan a fele rétegjelzéses.
3. Azonos seed azonos ingersorozatot ad mindkét változatban, egymástól függetlenül.
4. Lapos platformon a `surround_search` súlya 0, és a hiány megjelenik az eredményképernyőn.
5. Az `occlusion` blokkban minden próbában legalább 1 tényleges takarási esemény történik.
6. A `depthchange` blokk rétegváltásos próbáinál a változó objektum szögmérete nem változik.
7. Egy teljes B futás 9–13 perc.
8. A `SIGNAL_SPATIAL_B` sor `variant = 'B'`-vel kerül a `runs` táblába.
9. Az A és B eredmények külön `personal_bests` sorba kerülnek.
10. A `surround` blokk céljainak legalább 25%-a a kiinduló nézeten kívül jelenik meg.
