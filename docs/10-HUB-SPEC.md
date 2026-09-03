# 10 — A KEZDŐTÉR (ARRIVAL SPACE) RÉSZLETES SPECIFIKÁCIÓ

**Állapot:** implementálva
**Kód:** `packages/client/src/shell/` (2D) · `packages/client/src/hub/HubScene.ts` (VR)

A kezdőtér az a hely, ahová a felhasználó belép, mielőtt bármit választana.
Négy dolgot kell tudnia elvégezni, kézikönyv nélkül:

1. **megérteni, mi ez a rendszer és mi fog vele történni**,
2. **látni minden modult**, ami ezen a területen létezik, és hogy melyik indítható,
3. **azonosítani magát** — opcionálisan — és látni a saját előzményeit,
4. **elindítani egy modult**, vagy belépni VR-be és ugyanezt megtenni a headsetben.

---

## 1. A BELÉPÉSI ÚTVONAL

```
Területválasztás  (A / B / C)
        │
        ▼
Kezdőtér 2D-ben   ── ENTER VR ──▶  Kezdőtér VR-ben
   (böngésző)                          (ugyanaz a tartalom, 3 panel)
        │                                     │
        └──────────► MODUL ◄──────────────────┘
```

Két felület, **egy állapot**. A `store` (`app/state.ts`) egyetlen forrás:
a belépés, a terület és az eredmények ugyanazok mindkét felületen, tehát a
lapon látott és a headsetben látott kép nem tud szétcsúszni.

### Miért van két felület?

A 2D shell nem kényelmi másolat, hanem **technikai szükségszerűség**: a böngésző
nem léphet magától immerzív munkamenetbe, ahhoz felhasználói gesztus kell.
Kell tehát egy lap, ahol az ENTER VR gomb megnyomható. Ha már van ilyen lap,
akkor legyen teljes értékű — laptopon és mobilon ez maga a termék.

### Miért van 3D kezdőtér is?

Mert az immerzív munkamenetbe való visszalépés minden alkalommal újabb gesztust
igényel. Ha modulváltáskor ki kellene lépni a headsetből, egy ötmodulos
munkamenet öt le- és felvételt jelentene. A 3D kezdőtérből minden modul
elindítható és minden eredmény megnézhető, tehát **egy belépés elég egy egész
munkamenethez**.

---

## 2. TERÜLETVÁLASZTÁS

Az első képernyő. Három kártya, mindegyik a saját palettájával megfestve, hogy a
választás előtt látható legyen, mit kap az ember.

Kártyánként: betűjel (A/B/C), cím, egy mondat a területről, és három szám:
hány modul releváns, hányban elsődleges, hány indítható most.

A választás a `#/defence`, `#/work`, `#/sport` URL-fragmentbe kerül, tehát
megosztható és könyvjelzőzhető. A választás megjegyzésre kerül; a fejlécben
mindig ott a „Terület váltás”.

---

## 3. A 2D KEZDŐTÉR FELÉPÍTÉSE

### 3.1. Fejléc
Terméknév (területfüggő), állapotjelzők:
- `offline` — sárga, ha a szerver nem érhető el (a rendszer ettől még működik),
- `VR kész` / `Böngésző mód` — megmondja, van-e immerzív mód ezen az eszközön,
- „Terület váltás”.

### 3.2. Bal panel — „Mi ez”
Területspecifikus cím és bevezető, majd négy szám: elérhető modul, most
indítható, mért képesség, a pontszám neve. Alatta a fő cselekvés:

- **BELÉPÉS VR-BE** — csak akkor aktív, ha van immerzív támogatás. Ha nincs,
  a gomb kiírja az okot, nem csak inaktív.
- **Modulok megtekintése** — ugorj a listához.

Alatta egy mondat, ami két különböző dolgot mond a két esetben. Ha van VR:
elmagyarázza, miért kell kattintani (gesztuskövetelmény). Ha nincs: elmondja,
hogy minden aktív modul fut egérrel és érintéssel is, és hogy az eredményeket a
rendszer külön eszközosztályként kezeli.

### 3.3. Jobb panel — Azonosító
Belépés előtt: mezőt kínál, és **kimondja, hogy a belépés opcionális** —
„Belépés nélkül is kipróbálhatsz minden aktív modult, az eredmény ilyenkor nem
kerül profilhoz.” Ez fontosabb, mint amilyennek látszik: ha a rendszer elhallgatná,
a felhasználó azt hinné, hogy mentődik.

Belépés után: az azonosító, hány futás van ezen a területen, a legjobb pontszám,
hány modult próbált ki, és kijelentkezés.

Az azonosító **3–24 karakter**, betű / szám / kötőjel, automatikusan nagybetűs.
A szerver ugyanezt a szabályt érvényesíti. Nevet a rendszer nem kér.

### 3.4. „Most indítható”
Azok a modulok, amelyek `active` vagy `external` állapotúak. Jelenleg:
**REACT**, **COMMAND**, **SPACE** (utóbbi külső alkalmazásként nyílik).

### 3.5. „Katalógus”
Az összes többi, ezen a területen releváns modul — láthatóan, de indíthatatlanul.
Ez szándékos: a katalógus mutatja meg, mivé nő a rendszer, és a relevancia-jelölés
mutatja meg, miért tartozik ide egy modul.

### 3.6. Modulkártya
- sorszám + kód + alcím (a **területre szabott** címmel, nem az általánossal),
- egy bekezdés arról, miért számít ez **ezen a területen**,
- állapotjelvény: `indítható` / `külső modul` / `fejlesztés alatt`,
- relevancia: `elsődleges` / `másodlagos`,
- többszemélyes moduloknál a létszám (`2-5 fő`),
- ha van korábbi eredmény, a személyes legjobb a jobb felső sarokban.

### 3.7. Eredmények
Bal oldalon az utolsó nyolc futás (modul, dátum, pontszám). Ha nincs egy sem,
konkrét javaslat: „Indíts el egy modult — a REACT a leggyorsabb belépő,
körülbelül hét perc.” Egy üres állapot, ami nem mond semmit, elpazarolt hely.

Jobb oldalon a **képességprofil radar-diagramja**. A tengelyek területfüggőek
(`PROFILE_AXES`). Minden tengely értéke a hozzájáruló modulok legjobb
eredményeinek súlyozott átlaga; **amelyik tengelyhez nincs adat, az üresen marad**,
nem nullára esik. A diagram alatt kiírja, hány tengelyen van adat.

### 3.8. Vizsgálatvezető (Phase 2)
Letiltott panel, amely leírja, mit fog csinálni az AI vizsgálatvezető. Azért van
itt már most, mert a helye architekturális döntés, nem utólagos ötlet.

### 3.9. Lábléc
A terület figyelmeztetése (teljesítménymutató, nem szakvélemény), és az
eszközosztály-szabály: egy Quest 3 ravasz és egy egérkattintás nem ugyanaz a mérés.

---

## 4. A VR KEZDŐTÉR FELÉPÍTÉSE

A felhasználó a szoba közepén áll. Három panel ível köré, 1,42 m sugáron:

```
        ┌──────────────┐
        │   MODULOK    │   0°, 1,62 × 1,16 m
        └──────────────┘
   ┌────┐              ┌────┐
   │MI EZ│  ←44°  44°→ │AZO- │   0,92 × 1,12 m
   └────┘              │NOSÍ-│
                       │ TÓ  │
                       └────┘
```

A tér a terület arculatát viseli (`Room`): padlórács, horizont-motívum
(radar / műszaki rajz / stadion), lebegő szemcsék, és néhány lassan forgó
primitív az élet jeleként — de vizuális zaj nélkül, mert ez is mérőeszköz.

### 4.1. Bal panel — MIRŐL SZÓL
A terület bevezetője, majd négy lépés („Válassz modult” → „Rövid leírás, majd
gyakorlás” → „Mért rész, itt már nincs segítség” → „Eredmény”), és az
adatkezelési mondat. Alul: **KILÉPÉS VR-BŐL** és **TERÜLET**.

### 4.2. Középső panel — MODULFAL
Lapozható rács, oldalanként 8 modul (2 × 4). Kártyánként ugyanaz az információ,
mint 2D-ben. Az indítható modulok kártyája világít és reagál a mutatóra;
a tervezettek halványak és nem kattinthatók.

Alul lapozó, és jobbra az aktuális azonosító — vagy **NÉVTELEN PRÓBA** sárgával,
hogy a felhasználó a headsetben is tudja, mentődik-e az eredménye.

### 4.3. Jobb panel — AZONOSÍTÓ / EREDMÉNY / PROFIL
Három fül.

**AZONOSÍTÓ.** Belépés előtt: a mező, egy „AZONOSÍTÓ BEÍRÁSA” gomb, amely
előhozza a **3D virtuális billentyűzetet** (a DOM `<input>` immerzív módban
láthatatlan), és egy „FOLYTATÁS NÉVTELENÜL”. Belépés után: azonosító, futásszám,
legjobb pontszám, kijelentkezés.

**EREDMÉNY.** Utolsó hét futás, és ha van olyan modul, amit többször csinált,
egy trend-sparkline.

**PROFIL.** Ugyanaz a radar, mint 2D-ben, a panelre rajzolva.

### 4.4. Virtuális billentyűzet
Derékmagasságban, előrehajtva (−0,5 rad), ahol a kéz természetesen pihen.
Nagybetűs, kötőjelet és szóközt tud, maximum 20 karakter. Ugyanaz a
`Panel` + raycast útvonal működteti, mint minden mást.

---

## 5. AZ EGYSÉGES UI-ÚTVONAL

Minden felület — 3D panelek, gombok, billentyűzet — canvas-textúrán rajzolódik,
és raycasttal működik:

```
VR:      kontroller sugár  ─┐
Asztal:  egér ray          ─┼─→ sík metszés → UV → canvas px → widget
Mobil:   érintés ray       ─┘
```

Következmények, amelyek nem nyilvánvalók:

- **A hover egyszerre egy mutatóé.** Két Quest kontrollerrel a gombok villódznának,
  ha mindkettő birtokolhatná; a hover azé, amelyik utoljára eltalált egy panelt.
- **A kattintás lenyomás + felengedés ugyanazon a widgeten.** Lecsúszás közben
  elengedve nem sül el — ez VR-ben gyakori, mert a kar remeg.
- **Panel-távolság platformfüggő.** VR-ben 1,9 m, lapos képernyőn 1,35 m, hogy
  a látott szögméret hasonló maradjon.
- **Csak a piszkos panelek rajzolódnak újra.** Egy 1500 × 1000 px-es canvas
  minden frame-ben újrarajzolva feleslegesen égetné az akkumulátort.

---

## 6. BELÉPÉS, ÉS AMI BELÉPÉS NÉLKÜL TÖRTÉNIK

| | Belépve | Névtelenül |
|---|---|---|
| Modul indítása | igen | **igen** |
| Eredmény a képernyőn | igen | igen |
| Eredmény a profilhoz kötve | igen | **nem** |
| Előzmény, trend, profil-radar | igen | csak ebben a böngészőben |
| Ranglista | igen | nem |
| Adatbázisba kerül | igen | igen, de azonosító nélkül (kapcsolható) |

A névtelen futás a szerverre is felkerül — kapcsolat nélkül —, mert a normaképzéshez
mennyiség kell. Ez `STORE_ANONYMOUS_RUNS`-szal kikapcsolható, és a felhasználó
az eredményképernyőn világos szöveget kap: „Névtelen próba — az eredmény nem lett
profilhoz rendelve.”

**Az azonosítás nem hitelesítés.** Felügyelt mérési helyzetet feltételezünk, ahol
a résztvevő a kapott azonosítót írja be. Erősebb azonosítás (PIN, SSO, operátor
által kiosztott token) telepítésfüggő; a séma helyet hagy neki.

---

## 7. KAPCSOLAT NÉLKÜLI MŰKÖDÉS

A kezdőtér szerver nélkül is teljes értékű:

- a modulkatalógus a kliensbe fordítva érkezik,
- a belépés helyi azonosítót ad (`local:` előtag), és jelzi, hogy nincs kapcsolat,
- a futások helyben tárolódnak és sorba állnak,
- a sor a következő sikeres kapcsolatnál automatikusan ürül, és a felhasználó
  értesítést kap arról, hány eredmény ment fel.

Ez nem elméleti: a demonstrációk jellemzően telefonos hotspoton, headseten
zajlanak, ahol a kapcsolat megszakadása a szokásos eset, nem a kivétel.

---

## 8. ELFOGADÁSI KRITÉRIUMOK

1. A területválasztásból bármelyik kártya a megfelelő arculatú kezdőtérre visz,
   és az URL-fragment megőrzi a választást újratöltés után.
2. A kezdőtér csak azokat a modulokat mutatja, amelyek relevanciája az adott
   területen nem `none`; az elsődlegesek előbb.
3. WebXR nélküli böngészőben az ENTER VR gomb inaktív és megmondja, miért.
4. Belépés nélkül elindítható a REACT és a COMMAND; az eredményképernyő
   kimondja, hogy az eredmény nem került profilhoz.
5. Belépés után a profil-radar legalább egy tengelyen adatot mutat, ha van
   legalább egy befejezett futás.
6. Az adatokkal nem rendelkező tengelyek üresek maradnak, nem nullák.
7. A SPACE modul kártyája új lapon nyitja a Shepard–Metzler alkalmazást, és
   ha a felhasználó immerzív munkamenetben volt, előbb kilép abból.
8. A VR kezdőtérben az azonosító a 3D billentyűzeten beírható, és a beírás után
   a jobb panel azonnal a belépett állapotot mutatja.
9. A VR kezdőtérből indított modul után a felhasználó **a VR kezdőtérbe tér
   vissza**, nem a 2D lapra, és nem lép ki az immerzív munkamenetből.
10. Szerver nélkül a teljes kezdőtér működik; az `offline` jelző látszik, és a
    futások helyben tárolódnak.
11. A modulfal lapozója helyesen kezeli a 18–19 modult (3 oldal), és a
    lapozógombok a szélső oldalakon inaktívak.
12. Egy panel újrarajzolása csak akkor történik, ha az állapota változott
    (hover, kattintás, adatfrissítés).
