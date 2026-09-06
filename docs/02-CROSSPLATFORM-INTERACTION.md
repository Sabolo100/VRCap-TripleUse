# 02 — KERESZTPLATFORM INTERAKCIÓS LEKÉPEZÉS

**Státusz:** kötelező referencia minden modulspecifikációhoz és implementációhoz
**Hatókör:** Meta Quest 3 (WebXR) · asztali böngésző (egér + billentyűzet) · mobil böngésző (érintés)
**Utolsó frissítés:** a mobil vezérlőréteg (`engine/ui/MobileControls.ts`) bevezetése után.
Az 1., 4/B, 4/C és 6. fejezet ekkor változott; a korábbi modulspecifikációk
mobilfejezetei ehhez lettek igazítva.

Ez a dokumentum azt írja le, hogyan képezünk le egy VR-re tervezett feladatot két olyan
platformra, amelyeknek nincs 6DoF kontrollere. Nem stílusútmutató: a benne rögzített
döntések befolyásolják a mért értékeket, ezért minden modulspecifikációnak hivatkoznia
kell rá, és minden eltérést külön indokolni kell.

---

## 1. ALAPELV: ABSZTRAKT AKCIÓ, NEM GOMB

A modul soha nem kérdezi, hogy „lenyomták-e a Quest jobb ravaszát”. A modul azt kérdezi,
hogy **történt-e `ACTION_PRIMARY`**. A leképezést egyetlen réteg végzi
(`engine/input/InputManager.ts`), és ez a réteg minden eseményhez hozzáadja:

- a **forrást** (`left` / `right` / `mouse` / `touch` / `key`),
- a **kezet** (`left` / `right` / `none`),
- az **időbélyeget** a `performance.now()` időalapon,
- és a **kvantálási bizonytalanságot** (`quantisationMs`).

Az utolsó a legfontosabb és a leggyakrabban kihagyott: a DOM-események saját
`event.timeStamp` értéket hoznak, amely a böngésző eseménykezelése előtt keletkezik,
a WebXR kontrollergombokat viszont **frame-enként pollozzuk**, tehát a válaszidő
felbontása egy frame-idő (Quest 3-on 90 Hz mellett ~11 ms). Ez nem hiba, hanem a
platform tulajdonsága — de csak akkor kezelhető, ha minden eseménnyel együtt tároljuk.

### Az akciótábla

| Absztrakt akció | VR (Quest 3 Touch) | Asztali böngésző | Mobil böngésző |
|---|---|---|---|
| `PRIMARY` | bármelyik ravasz | bal egérgomb **vagy** SZÓKÖZ | **a modul által deklarált elsődleges gomb** a vezérlősávon |
| `SECONDARY` | bármelyik markolat (grip) | jobb egérgomb | a vezérlősáv második gombja |
| `LEFT` | bal ravasz | `F` vagy `←` | a vezérlősáv BAL feliratú gombja |
| `RIGHT` | jobb ravasz | `J` vagy `→` | a vezérlősáv JOBB feliratú gombja |
| `CONFIRM` | `A` / `X` gomb | `Enter` | koppintás a megerősítő elemre |
| `CANCEL` | `B` / `Y` gomb | `Escape` | koppintás a mégse elemre |
| `MENU` | bal `X` gomb | `Tab` | menü ikon |
| mutatás (POINT) | kontroller sugár | egérpozícióból vetített sugár | érintési pontból vetített sugár |
| helyváltoztatás | bal thumbstick / teleport | `WASD` | koppintás a célpontra (teleport) |
| fordulás | jobb thumbstick (snap) | `Q` / `E` vagy húzás | **húzás a jeleneten** (`look: 'yaw'`), ha a modul kéri |

`F` és `J` azért lett a kétkezes alapértelmezés, mert vakon gépelésnél ezeken pihen a
két mutatóujj, tehát a bal/jobb kéz szétválasztása a billentyűzeten is valódi marad.

**Ami megváltozott.** Az eredeti mobil leképezés a képernyő bal/jobb harmadát rendelte
`LEFT` / `RIGHT` akcióhoz, az `PRIMARY`-t pedig bárhová koppintáshoz. Ez két okból
megbukott az első valódi telefonos körben: **láthatatlan** (a felhasználó nem tudja, hogy
a képernyő harmadai gombok), és **ütközik a jelenettel** (ha a feladat maga is koppintással
válaszol egy térbeli objektumra, minden találat egyben `PRIMARY` is). Amint egy modul
valódi gombokat deklarál, a képernyőharmad-leképezés kikapcsol
(`input.setTouchZonesEnabled(false)`), és csak a látható gombok tüzelnek.

---

## 2. A HÁROM LEKÉPEZÉSI OSZTÁLY

Minden feladatelemet be kell sorolni az alábbi három osztály egyikébe. A besorolás
dönti el, hogy az eredmények összehasonlíthatók-e platformok között.

### 2/A — EKVIVALENS (`equivalent`)

A feladat lényege nem függ a beviteli eszköz térbeli tulajdonságaitól. Csak a
*mikor* számít, nem a *hova*.

**Példák:** egyszerű reakcióidő, választásos reakció, go/no-go gátlás, n-back,
hangalapú felismerés.

**Következmény:** a nyers érték platformok között **eltolással** különbözik
(a VR-lánc kb. 40–70 ms többletlatenciát ad egy fizikai gombhoz képest), de a
*személyen belüli* mintázatok — szórás, lapszus-arány, éberség-lejtés, hiba utáni
helyreállás — érvényesek maradnak. Rangsorolás csak eszközosztályon belül.

### 2/B — ADAPTÁLT (`adapted`)

A feladat átvihető, de a paramétereit a platform fizikai korlátaihoz kell igazítani.
A paraméterváltozást **a trial rekordba is bele kell írni**.

**Példák:** célra mutatás szögtartománya, folyamatos követés amplitúdója,
perifériás inger excentricitása, térbeli hang iránya.

**Kötelező szabály:** egy 65°-os böngészőablak fizikailag nem tud megmutatni egy
42°-kal oldalra eső célt. A REACT modul ezért platformfüggő geometriát használ:

| Blokk | VR | Asztali | Mobil |
|---|---|---|---|
| Célra mutatás, azimut | ±42° | ±26° | ±20° |
| Célra mutatás, elevatio | +20° / −16° | +14° / −12° | +12° / −10° |
| Célméret (szögátmérő) | 3,2 / 4,6 / 6,4° | 3,6 / 5,2 / 7,0° | 5,0 / 6,5 / 8,5° |
| Követés amplitúdó (m) | 1,05 × 0,42 | 0,72 × 0,34 | 0,50 × 0,30 |
| Kétkezes célok távolsága | ±0,62 m | ±0,50 m | ±0,50 m |

A mobil célok azért nagyobbak, mert az ujj takarási és pontossági hibája nagyobb,
mint egy karnyújtásnyira tartott kontrolleré. Ha ezt nem kompenzálnánk, a mobil
felhasználó nem „rosszabb”, hanem *más* feladatot kapna.

### 2/C — NEM ÁTVIHETŐ (`vr-only`)

A konstruktum a 6DoF követésből származik, és nincs értelmes 2D megfelelője.

**Példák:** fejlengés-alapú poszturális stabilitás (STEADY), valódi kétkezes
manipuláció szabad térben (HANDS), fejfordulás-alapú pásztázási lefedettség.

**Következmény:** a modul `supports` mezőjében **nem szerepel** a `desktop` / `mobile`.
A kezdőtér ilyenkor magyarázatot ír ki, nem pedig egy leromlott változatot kínál.
Egy rosszul leképezett mérés rosszabb, mint a hiánya, mert értelmezhetőnek látszik.

---

## 3. ÖT VESZÉLYES KÜLÖNBSÉG

Ezeket minden modulspecifikációnál át kell gondolni, mert némán rontják el a mérést.

### 3.1. Hover nem létezik érintésen

Asztalon és VR-ben van „a mutató a célon van, de még nincs válasz” állapot. Mobilon
nincs: az első érintkezés már maga a válasz. Következmény: a *mozdulat megindulása*
és a *mozdulat befejezése* mobilon nem választható szét.

**Szabály:** a `movement_initiation_time` és `movement_time` metrika mobilon `null`,
nem 0. A modulspecifikációnak fel kell sorolnia, mely metrikák esnek ki melyik
platformon.

### 3.2. Az érintés takar

Az ujj eltakarja a célt. Ezért mobilon a visszajelzést a célpont *fölé* vagy *mellé*
kell tenni, és a célméretet növelni kell (lásd 2/B).

### 3.3. A folyamatos követés érintésen csak lenyomva működik

`pointermove` csak akkor keletkezik, amíg az ujj a képernyőn van. A követési blokk
mobilon tehát „tartsd rajta az ujjad” feladat. Az ujj felemelése mérési szünet,
nem hiba — a modulnak ezt eseményként naplóznia kell, és az elemzésnek ki kell
zárnia az érintésmentes szakaszokat a hibaszámításból.

### 3.4. A fejirány nem tekintet

A Quest 3-ban nincs szemkövetés. A fej iránya használható közelítő figyelmi
mutatóként, de **soha nem nevezhető gaze-nek**. Asztalon és mobilon a fejirány
egyáltalán nem létezik: a pásztázási metrikák helyére a mutató mozgása lép,
és ezt a metrika nevében is jelezni kell (`pointer_scan_coverage` ≠ `head_scan_coverage`).

### 3.5. A koppintás egyszerre válasz és navigáció

Ha egy modul mobilon egyszerre enged körbefordulást (húzás) és koppintásos választ,
a kettő ugyanabból a `pointerdown`-ból indul. A `InputManager` ezért **elhalasztja**
a `PRIMARY`-t a `pointerup`-ig, és csak akkor bocsátja ki, ha az ujj a lenyomás óta
12 pixelen belül maradt (`TAP_SLOP_PX`). Ennek mérési ára van: nézetforgatást engedő
blokkban a válaszidő az ujj **felemelésekor** keletkezik, nem a lenyomásakor.

**Szabály:** időzítést mérő blokk (reakcióidő, szinkronizáció, SSRT) mobilon
**nem** engedélyezhet `look` húzást. Ahol mégis kell körülnézés, a válasz egy
vezérlősávi gombra kerül, mert az `pointerdown`-ra tüzel, és nem érinti a slop-logikát.

---

## 4. AZ UI ÁTVITELE: EGY IMPLEMENTÁCIÓ, HÁROM PLATFORM

A platform minden felületét — kezdőtér, instrukció, eredmény, COMMAND brief,
virtuális billentyűzet — **canvas-textúrás 3D panel** rajzolja
(`engine/ui/Panel.ts`). A panel síkját raycasttal metsszük, az ütközési UV-t
visszaváltjuk canvas-pixellé, és ott keressük meg a widgetet.

Ennek az a haszna, hogy a gombkezelés kódja nem tud a platformról:

```
VR:      kontroller sugár  ─┐
Asztal:  egérpozíció ray   ─┼─→ ugyanaz a raycast → ugyanaz az UV → ugyanaz a widget
Mobil:   érintés ray       ─┘
```

**Panel-távolságok.** A VR-ben kényelmes 1,9 m-es olvasótávolság egy 65°-os
lapos képernyőn a viewport harmadát foglalná el. A panelt ezért lapos módban
előrébb hozzuk (1,35 m), így a látott *szögméret* nagyjából azonos marad.

**Szögméret, nem pontméret.** Egy glyph látott mérete `fontPx / (pxPerMeter × távolság)`
— a panel fizikai szélessége teljesen kiesik. Nagyobb szöveghez tehát **`pxPerMeter`-t
kell csökkenteni** és `width`-et ugyanannyival növelni; a rajzoló callback egy sorát
sem kell átírni.

**Szövegbevitel.** Immerzív munkamenetben a DOM `<input>` nem látszik. Minden
VR-ben bekért szöveg (azonosító, szobakód, üzenet) a `Keyboard3D` panelen megy át.
Lapos módban a natív DOM űrlapot használjuk, mert az gyorsabb és akadálymentesebb.

---

## 4/B. A MOBIL VEZÉRLŐRÉTEG

A 3D panel mindhárom platformon működik, de **nem minden feladatelem panel**.
Két dolognak nincs érintéses megfelelője: a ravasz (ami nem egy helyre mutat,
hanem egy időpontot jelöl) és a fejfordítás. Ezekre való a
`engine/ui/MobileControls.ts` — DOM-réteg a vászon fölött, amit csak telefonon
hozunk létre (`ModuleContext.mobileControls`, egyébként `null`).

### A vezérlőkészlet

A modul **deklarálja, mire van szüksége**, a réteg megrajzolja:

| Elem | Mire való | Példa |
|---|---|---|
| `buttons[]` | időzített válasz, kizáró válasz („nincs cél”), kétkezes bal/jobb | WATCH: `ELTÉRÉS`; HOLD: `MOST` |
| `hint` | egysoros emlékeztető a gombok fölött | „Mi volt középen?” |
| `dial` | **iránykérdés**: N szegmens körben, opcionális címkékkel | FIELD 8 irányú perifériás válasz, 4 irányú rés |
| `slider` | folytonos becslés címkével és mértékegységgel | távolság- vagy magabiztosság-becslés |
| `reticle` | képernyőközépi célkereszt „fordulj rá” típusú válaszhoz | — |
| `look` | `off` / `yaw` / `free`: húzással forgatás | 360°-os blokkok |

### Szabályok, amelyek mérési okból nem tárgyalhatók

1. **A gomb `pointerdown`-ra tüzel, nem `click`-re.** A böngésző click-szintézise
   ~50–100 ms-ot tesz a válaszidőre, és itt minden modul időt mér.
2. **A gomb valódi `ActionEvent`-et küld** (`input.emitSynthetic()`), tehát a modul
   meglévő `PRIMARY` / `SECONDARY` / `LEFT` / `RIGHT` kezelője változatlanul működik.
   A telefon így nem külön kódág, hanem az akció újabb forrása.
3. **A forgatás a rigot forgatja, nem a kamerát.** A kamera transzformációja az XR
   pózé; ha a modul beleír, VR-ben rossz irányba néz a jelenet.
4. **A réteg megmondja, mennyit takar** (`reportInset`), és a motor ennyivel eltolja
   a projekciót (`camera.setViewOffset`). Enélkül a vezérlősáv eltakarja azt a
   panelgombot, ami alatta van — ez valódi, felhasználó által jelentett hiba volt.
   A mérés **szinkron**: `requestAnimationFrame`-re várni nem szabad, mert a blokk
   indulásakor nem garantált, hogy fut a frame-ciklus.
5. **Csak a ténylegesen érintést nyelő sáv számít insetnek.** A `hint` nem vesz fel
   eseményt, tehát a mögötte lévő inger továbbra is választható; ha neki is helyet
   foglalnánk, egy keresési tömb teteje lecsúszna a képernyőről.
6. **Futó állapoton kívül nincs vezérlő.** A `ModuleRunner.setState()` minden nem
   futó állapotban (`intro`, `instructions`, `ready`, `result`) törli a réteget,
   különben a sáv eltakarja az indítógombot.

### A telefon látómezeje

| | Álló | Fekvő |
|---|---|---|
| Asztali/VR-lapos FOV | 78° | 65° |
| **Mobil FOV** | **62°** | **42°** |

A telefon fizikailag kicsi és közel van a szemhez: ugyanaz a jelenet ugyanazzal a
FOV-val a laptopon olvasható, telefonon nem. A szűkebb FOV **közelebb hozza** a
tartalmat anélkül, hogy a kamera pozícióját elmozdítanánk — ez fontos, mert a
kamerapozíció VR-ben a fejpóz, tehát nem a modul tulajdona.

---

## 4/C. MIT JELENT „MOBILRA KÉSZ” EGY MODULNÁL

Egy modul akkor mobilra kész, ha mind a hat igaz:

- [ ] Minden válaszmód elérhető ujjal — nincs olyan válasz, amit csak ravasz ad ki.
- [ ] A vezérlők **blokkonként** vannak beállítva (`mc.set(...)` a blokk elején),
      nem egyszer az `init`-ben, mert blokkonként más a kérdés.
- [ ] Az iránykérdés `dial`, nem gombsor. A körben elhelyezett válasz gyorsabban
      található el és nem olvasható félre.
- [ ] A `controlHint` a **tényleges** mobil gombot nevezi meg, nem azt, hogy „koppints”.
- [ ] Ha a blokk időt mér, `look` nincs bekapcsolva (lásd 3.5).
- [ ] Ami mobilon nem mérhető, az **hiányzik** — nem közelítjük (lásd `03-SPATIAL-DESIGN.md` 4.).

---

## 5. AMIT MINDEN FUTÁS KÖTELEZŐEN TÁROL

Enélkül az adat később nem értelmezhető:

```
platform            vr | desktop | mobile
deviceClass         quest3 | quest3s | quest2 | desktop | mobile | …
inputMode           controller | hands | mouse | touch
browser + verzió
refreshRate / frameInterval
comparability       vr:quest3:controller | flat:mouse | flat:touch
moduleVersion + configVersion
adaptációs paraméterek  (pl. spreadDeg, amplitude)
```

A `comparability` kulcs a rangsorolás és a normaképzés egyetlen engedélyezett
szűrője. **Két futás csak akkor hasonlítható össze, ha ez a kulcs megegyezik.**
Enélkül a ranglista nem embereket, hanem hardvert rangsorol.

---

## 6. ELLENŐRZŐLISTA ÚJ MODULHOZ

Egy modulspecifikáció addig nincs kész, amíg ezekre nincs válasz:

- [ ] Minden feladatelem be van sorolva: `equivalent` / `adapted` / `vr-only`.
- [ ] Az adaptált elemek platformonkénti paramétertáblája megvan.
- [ ] Fel van sorolva, mely metrika esik ki melyik platformon (és miért).
- [ ] A `supports` mező őszinte: ha egy platformon a mérés értelmetlen, nincs benne.
- [ ] Minden akció az absztrakt akciótáblából származik; nincs eszközspecifikus kód.
- [ ] Az instrukciószöveg platformfüggő (`controlHint`), és a tényleges gombot nevezi meg.
- [ ] **A mobil vezérlőkészlet blokkonként meg van adva** (gomb / dial / slider / look),
      és teljesíti a 4/C ellenőrzőlistát.
- [ ] A trial rekord tartalmazza a használt adaptációs paramétereket.
- [ ] Megfogalmazott állítás arról, hogy az eredmények platformok között
      összehasonlíthatók-e — és ha nem, az miért van rendben.
