# 19 — MODUL 09: MEMORY
## Munkamemória — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** `packages/client/src/modules/memory/MemoryModule.ts`
**Támogatott platformok:** VR (teljes) · asztali, mobil (szűkített térfogat)
**Névleges időtartam:** ~9 perc
**Doménkötés:** A elsődleges · B elsődleges · C másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a MEMORY azt méri, mennyi térbeli információt tud valaki
egyszerre fejben tartani, frissíteni és zavarás után visszaadni — **és mi
történik ezzel az információval, ha közben megváltozik a nézőpont**.

### Miért térfogat, és nem tábla

A Corsi-féle kockakopogtatás egy asztalon fekvő, síkba rendezett
kockakészlet. Ez a modul helyette **térfogatban** helyezi el a kockákat:
három mélységi rétegben, szemmagasság alatt és fölött, a résztvevő
körül ívelve.

Ez nem ugyanaz a feladat nehezebben. Három dolgot változtat:

1. **A mélység önálló kódolási dimenzió.** Két kocka lehet azonos irányban,
   de eltérő távolságban. A síkbeli változatban ilyen nincs. A
   `depth_confusion_rate` (a helyes irányba, de rossz mélységbe mutatott
   válaszok aránya) csak térben mérhető, és megmutatja, kódolja-e valaki
   egyáltalán a távolságot.
2. **A felidézés testhez kötött.** A résztvevő nem egy táblára mutat, hanem
   a saját teste körüli térbe. Az emléknyom így egocentrikus referenciakerethez
   kötődik, ami operatívan a releváns eset.
3. **A nézőpont elmozdítható** — ez a 2. blokk, és a modul legérdekesebb
   része.

### A modul tudományos gerince: térbeli frissítés

A 2. blokkban a sorozat bemutatása után a kép **elsötétül**, a
kockatömb **elfordul 90 vagy 180 fokkal**, majd újra láthatóvá válik.
A résztvevőnek a sorozatot az **új helyzetben** kell visszaadnia.

Mivel a forgás nem látható, nincs mit követni: a tárolt téri emléknyomra
kell alkalmazni egy transzformációt. Ez a **térbeli frissítés**, és
elkülönül attól, hogy valaki mennyit tud megjegyezni.

A két blokk különbsége — `updating_cost` = a sima terjedelem mínusz a
forgatott terjedelem — azt méri, mennyibe kerül a transzformáció.
Két résztvevő azonos Corsi-terjedelemmel teljesen máshogy viselkedhet itt,
és operatívan ez a fontosabb: a valós helyzetben a világ ritkán marad
ugyanabban a helyzetben, mint amikor megjegyeztük.

Ez a blokk **nem mentális forgatás** (SPACE, 02): ott egy *látott* objektum
két nézetét kell összevetni; itt egy *emlékezetben tárolt* elrendezésre kell
transzformációt alkalmazni. A kettő elkülönül, és a manifeszt is így kezeli.

### Mért konstruktumok

| Konstruktum | Katalógus # | Blokk | Paradigma |
|---|---|---|---|
| Munkamemória | 25 | 1–5 | Corsi, n-back |
| Vizuális memória | 26 | 1, 3 | — |
| Téri memória | 15 | 1, 2 | 3D Corsi |
| Térbeli frissítés | — | 2 | Rejtett transzformáció |
| Sorrendmemória | 88 | 1, 2, 5 | Sorozat-visszaadás |
| Kötés (mi–hol) | — | 3 | Object-location binding |
| Frissítés folyamatosan | 25 | 4 | Térbeli n-back |
| Felidézés zavarás után | 30 | 5 | Interferencia |

### Amit a modul NEM mér

- **Nem hosszú távú memória.** Minden felidézés másodperceken belül
  történik. Egy nap múlva mit tud, arról ez a modul semmit nem mond.
- **Nem mentális forgatás.** Lásd fent: a 2. blokk emléknyomot
  transzformál, nem látott objektumot.
- **Nem verbális munkamemória.** Nincs benne szó, szám vagy betű.
  Ez szándékos: a modul nyelvfüggetlen, és a verbális bekódolást
  („bal-fent-hátul-közép") a bemutatási tempó szándékosan megnehezíti.
- **Nem demenciaszűrés és nem klinikai eszköz.**

---

## 2. MIÉRT RELEVÁNS DOMÉNENKÉNT

**A — Védelmi (elsődleges).** Parancsmegtartás és térbeli helyzetkép:
egy rádión kapott sorrend, több pozíció egyidejű fejben tartása, és — a 2.
blokk — ugyanezek felidézése azután, hogy a saját helyzet megváltozott.
Beosztások: rádiós, tüzérségi előretolt figyelő, parancsnok, felderítő.

**B — Munkaalkalmasság (elsődleges).** A munkamemória-kapacitás a legtöbb
hibázás forrása ott, ahol több adatot kell egyszerre fejben tartani
zavaró környezetben. Az 5. blokk (felidézés zavarás után) pontosan a
megszakított munkavégzés helyzete.
Munkakörök: ápoló, gyógyszerész, pilóta, diszpécser, pénzügyi ügyintéző.

**C — Sport (másodlagos).** Beadott játékrendszer, edzői instrukció és
koreográfia pontos felidézése — és a 2. blokk azt is, hogy ez működik-e
akkor, ha a csapat a pálya másik oldalán támad.

---

## 3. FELADATSTRUKTÚRA

Az alaphelyzet: **12 kocka** lebeg a résztvevő előtti térfogatban,
három mélységi rétegben (2,4 / 3,4 / 4,6 m), −14° és +22° közötti
elevatión, ±48° (VR) azimuton. Minden kocka **lassan forog**, tehát
tömör testként olvasható, nem síkidomként.

| # | Blokk | Gyakorló | Mért | Idő | Mit izolál |
|---|---|---|---|---|---|
| 1 | TÉRBELI SOROZAT | 2 | adaptív, ~14 | ~2:10 | téri terjedelem (3D Corsi) |
| 2 | ELFORDULT TÉR | 2 | 10 | ~2:10 | **térbeli frissítés** |
| 3 | MI–HOL | 2 | 12 | ~1:40 | tárgy-hely kötés |
| 4 | FOLYAMATOS | 3 | 40 | ~1:40 | térbeli 2-back |
| 5 | ZAVARÁS UTÁN | 1 | 8 | ~1:40 | felidézés interferencia után |

### 3.1. Blokk 1 — Térbeli sorozat (adaptív 3D Corsi)

Kockák villannak fel egymás után (mindegyik 700 ms-ig világít és
negyed fordulatot tesz), 350 ms szünettel. A résztvevő ezután
ugyanabban a sorrendben rájuk mutat.

**Adaptív hossz.** A sorozat 3 elemmel indul.
- Egy adott hosszon **két próba** fut.
- Ha mindkettő helyes → a hossz nő eggyel.
- Ha mindkettő hibás → a blokk véget ér.
- Ha egy helyes, egy hibás → a hossz marad, még két próba.
- Felső határ 9, alsó 2.

**A terjedelem** (`corsi_span`) a leghosszabb hossz, amelyen legalább
egy próba helyes volt. Emellett rögzül a `corsi_total_correct`
(összes helyes próba), ami finomabb felbontású, mint a terjedelem.

**Miért a villanás + negyed fordulat?** Mert a puszta felvillanás
lapos jelzés. A negyed fordulat a kockát térbeli testként mutatja meg,
és a mélységi rétegben lévő kockáknál egyértelműbbé teszi, melyik villant.

### 3.2. Blokk 2 — Elfordult tér (térbeli frissítés)

Ugyanaz a bemutatás, **rögzített 4 elemű** sorozattal (a terjedelemtől
függetlenül, hogy a két blokk összevethető legyen).

A sorozat után:
1. a kép **elsötétül** 600 ms alatt,
2. a kockatömb **elfordul** a saját függőleges tengelye körül
   **90° (60%) vagy 180° (40%)**, véletlen irányba,
3. a kép **visszatér** 400 ms alatt,
4. a résztvevő az **új** helyzetben adja vissza a sorozatot.

A forgás **nem látható**. Ha látható lenne, a feladat vizuális követés
volna, nem frissítés.

**Kontrollpróbák:** a próbák 30%-ában a forgás **0°** — a tömb nem
mozdul, de a sötétedés ugyanúgy megtörténik. Enélkül a
frissítési költséget nem lehetne elválasztani a sötétedés okozta
általános zavarástól.

### 3.3. Blokk 3 — Mi–hol (tárgy-hely kötés)

Hat **különböző alakzat** (kocka, gömb, kúp, henger, tórusz, kapszula)
jelenik meg hat pozíción, 4500 ms-ig, mindegyik forogva. Ezután minden
eltűnik, és **egy** alakzat jelenik meg a résztvevő előtt 1,2 m-re.

Feladat: mutass oda, **ahol ez az alakzat volt**.

- **12 próba**, próbánként új elrendezés és új kérdezett alakzat.
- **Metrikák:** szöghiba (irány), mélységhiba (távolság), és
  `swap_error` — a válasz egy **másik** alakzat helyéhez esik közelebb,
  mint a helyeshez. Ez utóbbi a kötés hibája, nem a helymemóriáé:
  a résztvevő tudta, hol voltak a dolgok, de nem tudta, melyik hol.

Ez a szétválasztás sík kijelzőn is lehetséges, de a mélységhiba nem.

### 3.4. Blokk 4 — Folyamatos (térbeli 2-back)

Egyetlen gömb ugrál a 12 pozíció között, 2200 ms-onként.
Feladat: reagálni, valahányszor a **jelenlegi pozíció megegyezik
azzal, ahol két lépéssel korábban volt**.

- **40 lépés**, ebből **12 találat** (30%).
- A csalik között szerepelnek **1-back** és **3-back** egyezések is
  (**5-5 darab**): ezek a „lure” próbák, amelyekre a rossz válasz a
  frissítés hibáját jelzi, nem a felismerését. Tíz csali az a minimum,
  amiből a csali-téves riasztás aránya egyáltalán becsülhető.

### 3.5. Blokk 5 — Zavarás után

Négy elemű sorozat bemutatása, majd **8 másodperc interferencia**:
egy gömb mozog a térben, és a mutatót rajta kell tartani. Ezután
következik a felidézés.

- **8 próba**, ebből **4 interferenciával** és **4 anélkül** (8 s
  üres várakozás). A kettő különbsége az `interference_cost`.
- Az interferencia szándékosan **téri-motoros**, nem verbális: így
  ugyanabba az erőforrásba nyúl, mint a tárolt tartalom.

---

## 4. INGERDEFINÍCIÓ

| Elem | Geometria | Méret | Szín |
|---|---|---|---|
| Memóriakocka | box | 0,26 m × depthScale | `#2A3A4C` alap, `#FFD166` villanáskor |
| Kötés-alakzatok | box, sphere, cone, cylinder, torus, capsule | 0,28 m × depthScale | 6 elemű paletta |
| N-back gömb | sphere | 0,24 m × depthScale | arculati kiemelő |
| Interferencia-gömb | sphere | 0,20 m | kiemelő → `ok` zöld célon |
| Szonda-alakzat (3. blokk) | az adott alakzat | 0,18 m | a saját színe |
| Kockakeret (kijelöléskor) | torus | a kocka körül | kiemelő |

**Elrendezés.** 12 pozíció, három mélységi rétegben (4-4-4), rétegenként
sztratifikált azimut. Minimális szögtávolság 11°, hogy a mutatás
egyértelmű legyen. Az angular méret a mélységgel arányosan skálázódik,
tehát a hátsó réteg **nem kisebb** — a mélységet a diszparitás, a
parallaxis és a rétegek közti takarás hordozza.

**Forgás.** Minden kocka saját tengelye körül forog 0,15–0,4 rad/s
sebességgel. Villanáskor a kocka **plusz negyed fordulatot** tesz
250 ms alatt — ez a jelzés térbeli komponense.

**Hang.** Villanáskor 1046 Hz, 60 ms. A sorozat végén 660 Hz, 120 ms
(„most te jössz"). A 4. blokkban minden ugrásnál halk 880 Hz-es kattanás,
hogy az ütem hallható legyen és ne kelljen figyelni az időzítésre.

---

## 5. KERESZTPLATFORM LEKÉPEZÉS

| Blokk | Osztály | Indoklás |
|---|---|---|
| 1 Sorozat | `adapted` | A térfogat szűkül, a mélységi rétegek megmaradnak. |
| 2 Elfordult tér | `adapted` | Ugyanaz; a forgás azonos. |
| 3 Mi–hol | `adapted` | A mélységhiba sík módban gyengébb jelentésű. |
| 4 2-back | `adapted` | Csak a térfogat szűkül. |
| 5 Zavarás | `adapted` | Az interferencia-gömb amplitúdója szűkül. |

### Adaptációs paraméterek

| Paraméter | VR | Asztali | Mobil |
|---|---|---|---|
| Azimut | ±48° | ±24° | ±19° |
| Elevatio | −14° … +22° | −10° … +14° | −9° … +12° |
| Mélységi rétegek | 2,4 / 3,4 / 4,6 m | 2,6 / 3,2 / 3,9 m | 2,6 / 3,1 / 3,7 m |
| Pozíciók száma | 12 | 12 | 9 |
| Minimális szögtávolság | 11° | 8° | 9° |

**A mélységi tartomány sík módban szándékosan szűkebb.** Diszparitás
nélkül a nagy mélységkülönbség csak perspektivikus méretjelzés lenne, amit
a konstans szögméret eltüntet — így a rétegek megkülönböztethetetlenné
válnának. A szűkebb tartomány őszintébb: kevesebbet állít.

### Platformonként kieső metrikák

| Metrika | VR | Asztali / mobil |
|---|---|---|
| `depth_confusion_rate` | ✓ | **kiesik** (a rétegek nem különülnek el megbízhatóan) |
| `binding_depth_error` | ✓ | **kiesik** |
| `corsi_span`, `updating_cost`, n-back, interferencia | ✓ | ✓ |

### Irányítási szöveg platformonként

| VR | Asztali | Mobil |
|---|---|---|
| „Mutass a kockákra a ravasszal, abban a sorrendben, ahogy felvillantak." | „Kattints a kockákra abban a sorrendben, ahogy felvillantak." | „Koppints a kockákra abban a sorrendben, ahogy felvillantak." |

A 4. blokkban: „Húzd meg a ravaszt / nyomj SZÓKÖZT / koppints, ha a gömb
ugyanott van, mint két lépéssel korábban."

---

## 6. NEHÉZSÉG ÉS KONFIGURÁCIÓ

Nehezítő tényezők: a sorozathossz, a bemutatási tempó, a pozíciók száma és
sűrűsége, a forgatás szöge, az n-back szintje, az interferencia hossza.

### `MEMORY_STANDARD_A` (alapértelmezés)

```
positions 12  layers [2.4,3.4,4.6]  az 48  el [-14,22]  minSep 11
span      start 3  max 9  perLength 2  flashMs 700  gapMs 350
rotate    trials 10  seqLength 4  angles {0:0.3, 90:0.42, 180:0.28}  blackoutMs 600
bind      trials 12  items 6  viewMs 4500
nback     steps 40  n 2  isiMs 2200  targets 12  lures {1back:5, 3back:5}
interfere trials 8  seqLength 4  delayMs 8000  half with tracking
```

### `MEMORY_SHORT` (~5 perc)

```
span perLength 2 max 7 · rotate 6 · bind 8 · nback 24 (targets 8) · interfere 4
```

### CHALLENGE mód

3-back, gyorsabb bemutatás, 16 pozíció, több 180°-os forgatás.
Az assessment eredménnyel nem keverhető, mert az adaptív terjedelem
lépcsője más.

---

## 7. METRIKÁK

### Nyers (próbánként)
`block` · `seqLength` · `sequence` (pozícióindexek) · `response`
(pozícióindexek) · `correct` · `firstErrorPosition` · `rotationDeg` ·
`probeShape` · `probeTruePos` · `responseAngErrorDeg` · `responseDepthErrorM` ·
`swapError` · `nbackType` (`target` / `lure1` / `lure3` / `filler`) ·
`responded` · `rtMs` · `withInterference`

### Származtatott (futásonként)

| Metrika | Definíció |
|---|---|
| `corsi_span` | A leghosszabb sorozathossz, amelyen legalább egy próba hibátlan volt |
| `corsi_total_correct` | Az összes hibátlan sorozat száma — finomabb, mint a terjedelem |
| `corsi_products` | Terjedelem × helyes próbák — a Corsi-irodalom szokásos összesített mutatója |
| `serial_position_first_error` | Az első hiba átlagos pozíciója a sorozatban; magas érték = a sorozat eleje stabil |
| `depth_confusion_rate` | Helyes irány, rossz mélységi réteg / összes hiba (**VR**) |
| `updating_span` | Hibátlan sorozatok aránya a forgatott blokkban |
| `updating_cost` | Hibátlan arány(0°-os kontroll) − hibátlan arány(elforgatott) |
| `updating_cost_180` | Ugyanez csak a 180°-os próbákon; jellemzően nagyobb, mint 90°-nál |
| `rotation_response_time` | Medián első válaszidő az elforgatott próbákon; a transzformáció ideje |
| `binding_accuracy` | Azon próbák aránya, ahol a válasz a helyes pozícióhoz esett legközelebb |
| `binding_ang_error` | Medián szöghiba fokban |
| `binding_depth_error` | Medián mélységhiba méterben (**VR**) |
| `swap_error_rate` | Válaszok aránya, amelyek egy **másik** bemutatott alakzat helyéhez esnek közelebb |
| `nback_d_prime` | Jelészlelés-elméleti érzékenység a 2-back feladatban |
| `nback_hit_rate` / `nback_fa_rate` | Bontva |
| `nback_lure_fa_rate` | Téves riasztás a 1-back és 3-back csalikon — a frissítés hibája |
| `nback_lure_cost` | `nback_lure_fa_rate − nback_fa_rate` a nem-csali próbákon |
| `nback_rt` | Medián válaszidő a találatokon |
| `recall_after_delay` | Hibátlan arány a 8 s-os késleltetés után, interferencia nélkül |
| `recall_after_interference` | Ugyanez interferenciával |
| `interference_cost` | A kettő különbsége |
| `tracking_during_interference` | A célon töltött idő az interferencia alatt — az interferencia tényleg terhelt-e |

### Score-ok (0–100) és horgonyaik

| Score | jó = 100 | rossz = 0 | Alap |
|---|---|---|---|
| `spatial_span` | terjedelem 7,5 | 3,0 | A Corsi-terjedelem felnőtt tartománya; térbeli változatban jellemzően valamivel magasabb, mint síkban. **Provizórikus** |
| `spatial_updating` | `updating_cost` 0 | 0,55 | **Provizórikus** |
| `binding` | pontosság 0,92 | 0,30 | 6 elemnél a véletlen ~0,17 |
| `continuous_updating` | n-back *d′* 3,2 | 0,6 | |
| `interference_resistance` | költség 0 | 0,45 | |

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Téri terjedelem | 0,28 |
| Térbeli frissítés | 0,22 |
| Folyamatos frissítés (n-back) | 0,20 |
| Tárgy-hely kötés | 0,16 |
| Interferencia-ellenállás | 0,14 |

A terjedelem és a frissítés együtt 50%: a modul állítása szerint az számít,
mennyit tud tárolni **és** mit tud kezdeni vele, ha a világ elmozdul.

---

## 8. ESEMÉNYNAPLÓ

| Esemény | Payload |
|---|---|
| `volume_built` | positions, layers, azSpan, minSep, platform |
| `sequence_shown` | block, length, sequence, flashMs, gapMs |
| `sequence_item` | index, position, layer, ordinal |
| `recall_started` | block, expectedLength |
| `recall_pick` | ordinal, position, correct, elapsedMs |
| `recall_complete` | correct, firstErrorPosition, rtMs |
| `blackout` | durationMs |
| `array_rotated` | degrees, direction |
| `bind_array_shown` | shapes, positions, viewMs |
| `bind_probe` | shape, truePosition |
| `bind_response` | angErrorDeg, depthErrorM, nearestShape, swapError |
| `nback_step` | step, position, type, isTarget |
| `nback_response` | rtMs, correct, type |
| `interference_start` / `interference_end` | durationMs, timeOnTarget |

**Mozgásnaplózás: 10 Hz.** A felidézési mutatás pályája utólag elemezhető
(pl. tétovázás egy kocka fölött), de ezredmásodperces felbontásra itt
nincs szükség.

---

## 9. ADATBÁZIS

Új tábla nem kell.

```jsonc
// trials.stimulus
{ "kind": "memory", "block": "rotate", "seqLength": 4, "sequence": [3,7,1,9],
  "rotationDeg": 90, "positions": [[az,el,r], ...], "platform": "vr", "practice": false }

// trials.response
{ "picks": [3,7,9,1], "correct": false, "firstErrorPosition": 2, "rtMs": 4820 }
```

---

## 10. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — „MEMORY / Munkamemória”, öt blokk. Kiemelve:
   *„A kockák nem egy táblán vannak, hanem körülötted a térben, különböző
   távolságokra. A távolság is számít.”*
2. **KALIBRÁCIÓ** — a résztvevő egyszer végigmutat mind a 12 pozíción,
   hogy megismerje a térfogatot és a mutatás módját. Ez nem mérés.
3. **INSTRUKCIÓ** blokkonként.
4. **GYAKORLÁS** visszajelzéssel; a 2. blokknál külön bemutatva, hogy a
   sötétedés után a tömb elfordulhat.
5. **MÉRÉS**.
6. **EREDMÉNY** — hat sor:

| Sor | Példaérték |
|---|---|
| Téri terjedelem | `6` (helyes sorozatok `9`) |
| Frissítési költség | `18 pont` (180°-nál `27`) |
| Folyamatos frissítés (*d′*) | `2,44` (csali-hiba `+0,14`) |
| Tárgy-hely kötés | `78%` (csere-hiba `12%`) |
| Interferencia-költség | `25 pont` |
| Mélységi tévesztés | `21%` a hibákból |

---

## 11. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** Az 1. blokk a Corsi-féle kockakopogtatás adaptív,
háromdimenziós változata. A 2. blokk a téri frissítési paradigmák
szerkezetét követi (rejtett transzformáció alkalmazása tárolt
elrendezésre). A 3. blokk tárgy-hely kötési feladat swap-hiba
elemzéssel. A 4. blokk térbeli n-back csalipróbákkal. Az 5. blokk
késleltetett felidézés téri-motoros interferenciával.

**Eltérések.** (a) A klasszikus Corsi 9 kocka egy síkban; itt 12 kocka
három mélységi rétegben, ami a terjedelmet jellemzően valamivel
megemeli — a horgonyok ehhez vannak igazítva, de **saját normaminta
nélkül ez becslés**. (b) A klasszikus változatban a kísérletvezető
kopogtat; itt automatizált a bemutatás, ami standardizáltabb, de a
tempó nem igazodik a résztvevőhöz. (c) A 2. blokk forgatása a tömböt
mozgatja, nem a résztvevőt: a valódi nézőpontváltás (elsétálás)
vesztibuláris komponenst is adna, ami itt hiányzik. Ezt a metrika
neve nem rejti el.

**Elvárt nagyságrendek** (egészséges felnőtt, Quest 3):
téri terjedelem 5–7 · hibátlan sorozat 7–12 ·
frissítési költség 0,10–0,35 (180°-nál nagyobb, mint 90°-nál) ·
n-back *d′* 1,8–3,2 · csali-hiba a nem-csalinál 0,05–0,20-szal magasabb ·
kötési pontosság 0,60–0,90 · swap-hiba 0,05–0,20 ·
interferencia-költség 0,10–0,35.

**Amit nem szabad kikövetkeztetni.** Egyetlen futásból nem következik
memóriazavar, tanulási nehézség vagy alkalmatlanság. A terjedelem
napszaktól, alvástól és VR-tapasztalattól is függ.

**Tanulási hatás.** A terjedelem 2–3 felvétel után 0,5–1 elemmel
emelkedik, majd stabilizálódik. A **frissítési költség robusztusabb**,
mint a nyers terjedelem, tehát longitudinálisan az informatívabb.
A pozíciókészlet és minden sorozat seedből generálódik; ismételt
méréskor kötelező más seed.

---

## 12. ELFOGADÁSI KRITÉRIUMOK

1. A 12 pozíció pontosan három mélységi rétegben, rétegenként 4 elemmel
   helyezkedik el.
2. Két pozíció szögtávolsága soha nem kisebb a konfigurált minimumnál.
3. Minden pozíció szögmérete azonos, a mélységtől függetlenül (± 0,2°).
4. Egy sorozatban ugyanaz a pozíció soha nem szerepel kétszer egymás után.
5. Az adaptív terjedelem 3 elemmel indul, hossznként 2 próbát futtat, és
   két egymást követő hibás próba után leáll.
6. A 2. blokkban a forgatás a sötétedés alatt történik, és a forgás
   egyetlen frame-en sem látható.
7. A 2. blokkban a próbák 30%-a 0°-os kontroll, ± 1 próba.
8. A 4. blokkban pontosan 12 találat, 5 darab 1-back és 5 darab 3-back
   csali van a 40 lépésben.
9. Az n-back első két lépése soha nem minősül találatnak.
10. Az 5. blokkban a 8 próbából pontosan 4 fut interferenciával.
11. Két azonos seedű futás azonos pozíciókat, sorozatokat, forgatási
    szögeket és n-back sorrendet ad.
12. Mérés közben nincs semmilyen helyességre vonatkozó visszajelzés.
13. A `swap_error` akkor és csak akkor igaz, ha a válasz egy másik
    bemutatott alakzat pozíciójához esik közelebb, mint a helyeshez.
14. Sík platformon a `depth_confusion_rate` és a `binding_depth_error`
    hiányzik, nem nulla.
15. Az eredményképernyő hat sora közül egyik sem tartalmaz `NaN`-t.
16. Szintetikus profilokon (erős / átlagos / gyenge) az OPS pontszám
    monoton csökkenő, legalább 180 pont különbséggel.
17. Két azonos terjedelmű, de eltérő frissítési költségű szintetikus
    profil közül a kisebb költségű kap magasabb pontszámot.
