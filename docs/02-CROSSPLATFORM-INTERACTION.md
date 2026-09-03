# 02 — KERESZTPLATFORM INTERAKCIÓS LEKÉPEZÉS

**Státusz:** kötelező referencia minden modulspecifikációhoz és implementációhoz
**Hatókör:** Meta Quest 3 (WebXR) · asztali böngésző (egér + billentyűzet) · mobil böngésző (érintés)

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
| `PRIMARY` | bármelyik ravasz | bal egérgomb **vagy** SZÓKÖZ | koppintás |
| `SECONDARY` | bármelyik markolat (grip) | jobb egérgomb | két ujjas koppintás |
| `LEFT` | bal ravasz | `F` vagy `←` | koppintás a bal képernyőharmadon |
| `RIGHT` | jobb ravasz | `J` vagy `→` | koppintás a jobb képernyőharmadon |
| `CONFIRM` | `A` / `X` gomb | `Enter` | koppintás a megerősítő elemre |
| `CANCEL` | `B` / `Y` gomb | `Escape` | koppintás a mégse elemre |
| `MENU` | bal `X` gomb | `Tab` | menü ikon |
| mutatás (POINT) | kontroller sugár | egérpozícióból vetített sugár | érintési pontból vetített sugár |
| helyváltoztatás | bal thumbstick / teleport | `WASD` | virtuális joystick |
| fordulás | jobb thumbstick (snap) | `Q` / `E` vagy húzás | húzás |

`F` és `J` azért lett a kétkezes alapértelmezés, mert vakon gépelésnél ezeken pihen a
két mutatóujj, tehát a bal/jobb kéz szétválasztása a billentyűzeten is valódi marad.

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

## 3. NÉGY VESZÉLYES KÜLÖNBSÉG

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

**Szövegbevitel.** Immerzív munkamenetben a DOM `<input>` nem látszik. Minden
VR-ben bekért szöveg (azonosító, szobakód, üzenet) a `Keyboard3D` panelen megy át.
Lapos módban a natív DOM űrlapot használjuk, mert az gyorsabb és akadálymentesebb.

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
- [ ] A trial rekord tartalmazza a használt adaptációs paramétereket.
- [ ] Megfogalmazott állítás arról, hogy az eredmények platformok között
      összehasonlíthatók-e — és ha nem, az miért van rendben.
