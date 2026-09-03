---
name: module-spec-writer
description: Turn a short VR CAP module sketch (a few lines from the master spec) into a complete, implementation-ready module specification. Use when the user asks to write, expand, generate or detail a specification for a VR CAP assessment module - by module code (SIGNAL, NAV, WATCH, ANTICIPATE, FIELD, STEADY, RHYTHM, ADAPT, HANDS, RISK, PROTOCOL, INTENT ...), by ordinal ("a 06-os modul"), or phrased as "csináld meg a részletes leírást", "expand module X", "detailed spec for X".
---

# VR CAP — MODULSPECIFIKÁCIÓ GENERÁTOR

Ez a skill egy rövid modulvázlatból (a master specifikáció 10–30 sorából) teljes,
azonnal implementálható modulspecifikációt készít.

## Mielőtt írni kezdenél

Olvasd be ebben a sorrendben:

1. `docs/00-MASTER-SPEC.md` — a modul vázlata, a doménrelevancia és a konstruktumlista.
2. `docs/02-CROSSPLATFORM-INTERACTION.md` — **kötelező**, a 6. fejezet ellenőrzőlistája
   a specifikáció átvételi feltétele.
3. `docs/03-SPATIAL-DESIGN.md` — **kötelező**. Ez dönti el, hogy a modul
   egyáltalán VR-modul-e, vagy csak egy sík teszt térbe vetítve.
4. `packages/shared/src/modules.ts` — a modul manifesztje (`constructs`, `headlineMetrics`,
   `domains`, `assetLoad`, `codeLoad`). A specifikáció ezekkel nem mondhat ellent;
   ha ellentmond, a manifesztet is módosítsd, és jelezd.
5. Egy már kész referencia: `docs/11-MODULE-04-REACT.md` (egyszemélyes, sok blokk)
   vagy `docs/12-MODULE-10-COMMAND.md` (többszemélyes, hálózati).
6. `packages/client/src/modules/react/ReactModule.ts` — a `AssessmentModule` szerződés
   valós használata; térbeli példának `watch/WatchModule.ts` (körülvevő rács)
   vagy `hold/HoldModule.ts` (közeledő testek).

## Kimenet

Egyetlen fájl: `docs/NN-MODULE-XX-<CODE>.md`, ahol `NN` a következő szabad
dokumentumsorszám, `XX` a modul kétjegyű sorszáma. Magyarul, a mellékelt
sablon szerint, minden fejezettel. Ha egy fejezet nem alkalmazható,
írd oda, hogy miért — ne hagyd ki.

## A specifikáció szerkezete

### 1. Cél és konstruktum
- Mit mér a modul **egy mondatban**, mérhető megfogalmazásban.
- A vizsgált konstruktumok listája, mindegyikhez: definíció, és hogy melyik
  paradigmából származik. A 136 elemű mérési katalógus sorszámai, ahol van megfelelés.
- **Amit kifejezetten NEM mér.** Ez a fejezet védi meg a projektet a
  túlígéréstől, és minden esetben ki kell tölteni.

### 2. Miért releváns doménenként
Az A (védelmi) / B (munka) / C (sport) területek közül azokra, ahol a manifeszt
`primary` vagy `secondary`: 1 bekezdés + 3–5 konkrét munkakör vagy sportág.
A `none` besorolást is indokold egy mondattal.

### 3. Feladatstruktúra
- Blokkok listája sorrendben; blokkonként: cél, próbaszám, gyakorlóprób aszám,
  becsült idő.
- **Ha a blokk nem próbaalapú**, mondd ki, mit számol a `trials` mező, és add
  meg a `BlockDescriptor.unitLabel` értékét. A RHYTHM első blokkja három
  *tempót* futtat 48-48 ütemmel, a STEADY blokkjai folyamatos *mérések* — az
  intro képernyőn „3 próba" mindkét esetben félrevezető volna.
- Blokkonként a **trial anatómiája**, a szabvány állapotgéppel megadva:
  `PREPARE → COUNTDOWN → STIMULUS → RESPONSE WINDOW → RESPONSE → FEEDBACK → INTER-TRIAL`,
  minden fázishoz konkrét ezredmásodperc vagy „várakozás válaszra”.
- Az ingerek eloszlása: mennyi a cél, mennyi a disztraktor, milyen arányban,
  milyen véletlenszerűséggel. Adj meg konkrét számokat, ne „megfelelő arányban”-t.

### 4. Ingerdefiníció a primitívkönyvtárból
Csak ezekből építkezz: gömb, kocka, henger, kúp, sík, gyűrű, tórusz, vonal, nyíl,
rács, felirat. Minden ingerhez: geometria, méret (méterben ÉS szögméretben a
felhasználó nézőpontjából), szín, fényerő, pozíció, mozgás, hang.
Külső 3D asset nem használható; ha elkerülhetetlen, külön indokold.

### 4/B. Térbeliség — a modul létjogosultsága

**Ezt a fejezetet a `docs/03-SPATIAL-DESIGN.md` szerint kell kitölteni, és
enélkül a specifikáció nincs kész.**

Kezdd azzal, hogy megválaszolod az alapkérdést:

> **Mi változna bármelyik mérőszámban, ha az egész jelenetet lelapítanám
> egyetlen, a résztvevő elé helyezett gömbhéjra?**

Ha a válasz „semmi", a modul nem VR-modul, csak egy sík teszt térben
megjelenítve. Ilyenkor két út van, és mindkettőt le kell írni:
a feladat átalakítása, vagy — ha az A változatot meg kell tartani a
szakirodalmi összehasonlíthatóság miatt — egy **B változat** tervezése.

Sorold fel, melyik térbeli eszközt használja a modul a hatból
(körülvevő elrendezés · mélység önálló csatornaként · közeledés és pálya ·
karnyújtásnyi tér · forgás és tömör test · rejtett transzformáció és
nézőpont), és **mindegyikhez azt a konkrét mérőszámot**, ami belőle
származik. Legalább kettőnek szerepelnie kell a pontozásban.

Jelöld meg, melyik mutató **VR-only**. Ezekre a 7. fejezetben ki kell
mondani, hogy sík platformon hiányoznak (nem nullák), a súlyuk nulla, és a
maradék súlyok átskálázódnak.

Ha a modul mélységi manipulációt használ, írd le a **szögméret-kompenzációt**:
a távoli objektum nem lehet egyszerűen kisebb, különben a mélység
méretmanipulációvá esik össze.

### 5. Keresztplatform leképezés
A `02-CROSSPLATFORM-INTERACTION.md` szerint:
- minden feladatelem besorolása `equivalent` / `adapted` / `vr-only`,
- az adaptált elemek platformonkénti paramétertáblája,
- a platformonként kieső metrikák listája,
- a `controlHint` szövege mind a három platformra, a tényleges gombot megnevezve.

### 6. Nehézség és konfiguráció
- Mi teszi nehezebbé a feladatot (ingersűrűség, sebesség, válaszablak, disztraktorok).
- Legalább két nevesített konfiguráció (`<CODE>_STANDARD_A`, `<CODE>_SHORT`),
  paraméterekkel kitöltve.
- Adaptív (CHALLENGE) mód: mi változik, és miért nem keverhető az assessment eredménnyel.

### 7. Metrikák
Három szinten, konkrét képlettel vagy algoritmussal:
- **Nyers** (trialonként): mit tárolunk, milyen mértékegységben.
- **Származtatott** (futásonként): pontos definíció. „Medián reakcióidő a helyes
  próbákon, a 100 ms alatti válaszok kizárásával” — nem „átlagos reakcióidő”.
- **Score** (0–100): normalizálási horgonyok (`good` és `poor` érték) és az
  indoklásuk. Ha csak becsült, írd oda, hogy provizórikus és mihez képest.

Az OPS SCORE összetevőit és súlyaikat táblázatban add meg; a súlyok összege 1.

### 8. Eseménynapló
A modul által kibocsátott eseménytípusok listája, mindegyikhez a payload mezői.
Ez a legfontosabb fejezet a hosszú távú értékhez: ami ma nem kerül a naplóba,
azt később semmilyen elemzéssel nem lehet visszaszerezni.
Add meg a motion logging frekvenciáját és annak indoklását.

### 9. Adatbázis
Mely mezők kerülnek a `trials.stimulus` / `trials.response` JSON-be, milyen néven.
Ha a modul új táblát igényel (mint a COMMAND a `team_*` táblákat), a DDL-t is add meg.

### 10. Felhasználói folyamat
Képernyőről képernyőre: intro, instrukció, kalibráció, gyakorlás, „most jön a mérés”,
mérés, feldolgozás, eredmény. Add meg a tényleges magyar szövegeket, ne helyőrzőket.
Az eredményképernyő 4–6 kiemelt sora, magyarul, mértékegységgel.

### 11. Validáció és korlátok
- Melyik publikált paradigmából származik, és miben tér el tőle.
- Milyen elvárt nagyságrendű értékek jönnek ki egészséges felnőttnél.
- Mi az, amit ebből a modulból **nem szabad** kikövetkeztetni.
- Tanulási hatás: mennyire ismételhető, mi változik a 2. és 5. felvételnél.

### 12. Elfogadási kritériumok
Ellenőrizhető állítások listája, amelyek mindegyike igaz vagy hamis:
- „Egy 20 próbás blokk 24 másodpercnél nem tart tovább.”
- „Két azonos seedű futás azonos ingersorrendet ad.”
- „Ha nincs válasz a válaszablakon belül, a próba `timeout` kimenettel zárul.”
Legalább 10 ilyen kritérium, és mindegyikhez az, hogy hogyan tesztelhető.
Ezek közül legalább kettő a térbeliségre vonatkozzon, például:
- „A távoli és a közeli objektum szögmérete 0,2 fokon belül megegyezik.”
- „Sík platformon a `depth_cost` metrika hiányzik, nem nulla.”
- „Az események legalább 25%-a a kezdő tájoláshoz képest 100 foknál nagyobb
  excentricitáson történik.”

## Ha B változatot írsz

A B változat ugyanannak a modulnak a térbeli kiterjesztése, nem új modul.

- **Ugyanazt a konstruktumot mérje**, mint az A. Ha mást mér, akkor új
  modult írsz, és új sorszámot kap.
- **Publikált paradigmán alapuljon**, annak térbeli kiterjesztéseként.
  Nevezd meg, melyiknek — a „3D-sítettem” önmagában nem indoklás.
- Kapjon külön `configVersion`-t (`<CODE>_SPATIAL_B`), és a specifikáció
  mondja ki, hogy az A és B eredmények **soha nem kerülnek egy
  normacsoportba**.
- Írd le, **mikor melyiket érdemes választani** — ez kerül a modulkártyára.
- A `supports` legyen őszinte: ha a B blokkjai karnyújtásnyi térben vagy
  360 fokos elrendezésben zajlanak, akkor `['vr']`, és nem több.
- A B változat specifikációja a meglévő modul-dokumentum **végére kerül**
  külön fejezetként, nem új fájlba — így a modul minden változata egy
  helyen olvasható.

## Írásmód

- **Számokat írj, ne mellékneveket.** „400–900 ms véletlen ISI, exponenciális
  eloszlásból” jó; „megfelelően változó időzítés” használhatatlan.
- Minden nem magától értetődő döntéshez tartozzon egy mondatnyi indoklás.
- Ha egy paraméterhez nincs szakirodalmi alapod, írd oda, hogy becslés,
  és mihez képest kell majd kalibrálni. Ne találj ki hivatkozást.
- A modul nyelvezetét igazítsd a doménhez, de a metrikanevek maradjanak angolul
  és `snake_case`-ben, mert azok az adatbázisba kerülnek.
- Terjedelem: jellemzően 400–700 sor. Ha rövidebb, valószínűleg hiányos.

## Amit soha ne csinálj

- Ne találj ki új mérési modalitást (szemkövetés, pulzus, EEG) — a Quest 3 alap
  konfigurációja nem adja. Ha egy konstruktumhoz ez kellene, írd le, hogy
  nem mérhető, és mi a legjobb közelítés.
- Ne ígérj személyiségjegyet, diagnózist vagy alkalmassági ítéletet. A modul
  megfigyelt teljesítményt mér. A megfogalmazás legyen
  „Observed performance under time pressure”, nem „stressztűrés”.
- Ne írj olyan feladatot, ami erős fej- vagy kameramozgatást igényel, mert az
  kinetózist okoz és a mérést is elrontja.
- Ne másold át a REACT paramétereit gondolkodás nélkül egy másik modulba.
- **Ne tekintsd térbeliségnek azt, ami csak renderelés.** Attól, hogy az
  objektum kocka és nem négyzet, hogy a panel a levegőben lebeg, hogy a
  felhasználó körülnézhet, vagy hogy a jelenetben van köd és perspektíva,
  még egyetlen mérőszám sem lett térbeli. Akkor térbeli, ha a **szám**
  megváltozik attól, hogy a tér három dimenziós.
- **Ne adj sík platformon becsült értéket egy VR-only mutató helyére.**
  A metrika hiányzik, a súlya nulla, és az eredményképernyő kimondja.
