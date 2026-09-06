# VR COGNITIVE ASSESSMENT PLATFORM — MASTER SPECIFIKÁCIÓ

**Verzió:** 2.0 — triple use
**Előzmény:** 1.0 „VR Dual Use Cognitive Assessment Platform” (védelmi fókusz)
**Elsődleges célhardver:** Meta Quest 3 · WebXR · böngészőből futtatva
**Másodlagos futtatás:** asztali böngésző, mobil böngésző
**Vizuális alapelv:** asset-light, procedurális 3D, primitívek, fény, hang, mozgás

---

## 0. MI VÁLTOZOTT AZ 1.0-HOZ KÉPEST

Az eredeti specifikáció egy védelmi célú kognitív mérőrendszert írt le, és
mellékesen említette, hogy a rendszer munkaalkalmassági és sportcélra is
használható. Ez a verzió ezt a mellékmondatot teszi a termék szerkezetévé.

| | 1.0 | 2.0 |
|---|---|---|
| Felhasználás | védelmi, „dual use” említés szintjén | **három egyenrangú terület**, saját arculattal |
| Modulok | 10 | **19** (10 eredeti + 9 új a sport és a munka miatt) |
| Modul–terület kapcsolat | nincs | minden modul **1–3 területhez** kötött, `primary`/`secondary` relevanciával, adatbázisban tárolva |
| Kezdőképernyő | egy, katonai | **területválasztás**, majd területspecifikus kezdőtér |
| Azonosító | Soldier ID | terület szerinti (Operator ID / Vizsgálati azonosító / Sportoló ID) |
| Pontszám neve | OPS SCORE | OPS SCORE / READINESS SCORE / PERFORMANCE INDEX — **azonos matematikával** |
| Vizsgálatvezető | — | AI vizsgálatvezető, chat alapú (Phase 2) |

Ami **nem** változott: az assessment engine, a mérési logika, az eseményalapú
naplózás, a scoring architektúra és a pszichometriai óvatosság. Egy motor van,
három arca.

---

## 1. A RENDSZER ALAPKONCEPCIÓJA

A VR Cognitive Assessment Platform moduláris, böngészőalapú VR assessment-rendszer,
amely három terület kognitív, észlelési, döntési, pszichomotoros és együttműködési
képességeit vizsgálja:

**A — VÉDELMI SZEKTOR.** Katonák és katonai jelöltek kiválasztása, longitudinális
követése, kiképzés előtti és utáni állapotfelmérés.

**B — MUNKAALKALMASSÁG ÉS PÁLYAVÁLASZTÁS.** Olyan munkakörök, ahol a figyelem, a
reakció, a terhelhetőség és a döntési stabilitás közvetlen biztonsági tényező:
gépjárművezető, mozdonyvezető, légiirányító, sebész, aneszteziológus, vezérlőterem-
operátor, mentőtiszt. Pályaorientációban ugyanez a profil erősség-térképként működik.

**C — SPORTÁGI TEHETSÉGAZONOSÍTÁS.** Melyik sportághoz van érzéke a gyereknek?
A rendszer nem a fizikai teljesítményt méri, hanem a percepciós-kognitív alapokat:
időzítést, előrejelzést, perifériás látást, döntési sebességet, mozgástanulási rátát.

A platform egyik területen sem szimulátor. Nem a valóság minél részletesebb
reprodukciójára törekszik — az alapgondolat pontosan az ellenkezője:

> **A vizsgált emberi képességet a lehető legtisztábban, minimális vizuális zajjal
> és minimális 3D tartalommal kell mérni.**

Ezért a feladatok absztrakt virtuális környezetben játszódnak: gömbök, kockák,
oszlopok, vonalak, síkok, gyűrűk, nyilak, ikonok, színek, fényimpulzusok, mozgások,
hangok, térbeli hangok és szöveges vagy hangalapú utasítások segítségével.

Ez három előnyt ad:

1. **Gyors fejleszthetőség** — nincs szükség komoly 3D modellezésre.
2. **Tiszta mérés** — kevesebb irreleváns vizuális inger.
3. **Standardizálhatóság** — pontosan ugyanaz a stimulus adható minden résztvevőnek.

Precedens: a brit Dstl/MoD korábban finanszírozott olyan VR skills assessment
rendszert, amely katonai személyzetnél többek között multitaskingot, időnyomás
alatti teljesítményt, térbeli tájékozódást, navigációt és felidézést vizsgált,
és az eredményeket más résztvevőkéhez hasonlította.

---

## 2. A HÁROM ARCULAT

Ugyanaz a kód, három design-változat. Az arculat **nem** befolyásolja a mérést:
a felület színe, tipográfiája és nyelvezete változik, az ingerek geometriája,
időzítése és a scoring nem. A definíciók egyetlen helyen élnek
(`packages/shared/src/domains.ts`), így egy negyedik terület hozzáadása egy
adatszerkezet kitöltése, nem újraírás.

### A — VÉDELMI

| | |
|---|---|
| Terméknév | VR COGNITIVE ASSESSMENT |
| Alaphangulat | sötét kékesfekete, borostyán kiemelés (#FF9E1B), keskeny nagybetűs tipográfia |
| Tér | radar-motívum: koncentrikus távolsággyűrűk, lassan forgó pásztázó szektor |
| Azonosító | Operator ID (pl. `HU-001572`) |
| Pontszám | **OPS SCORE** 0–1000 |
| Nyelvezet | „misszió”, „operátor”, „futás” |

### B — MUNKAALKALMASSÁG

| | |
|---|---|
| Terméknév | VR ALKALMASSÁG & PÁLYAORIENTÁCIÓ |
| Alaphangulat | grafitzöld, türkiz kiemelés (#22D3C5), humanista sans, klinikai tisztaság |
| Tér | műszaki rajz-motívum: halvány falsíkok, mérőléc-osztások |
| Azonosító | Vizsgálati azonosító (pl. `PRO-2026-0184`) |
| Pontszám | **READINESS SCORE** 0–1000 |
| Nyelvezet | „vizsgálat”, „vizsgált személy”, „mérés” |

### C — SPORT

| | |
|---|---|
| Terméknév | VR SPORT TALENT LAB |
| Alaphangulat | mélylila, lime kiemelés (#C6FF3D) + magenta (#FF2E93), vaskos display-tipográfia |
| Tér | stadion-motívum: pályavonalak, világító horizontsáv |
| Azonosító | Sportoló ID (pl. `ATH-2026-041`) |
| Pontszám | **PERFORMANCE INDEX** 0–1000 |
| Nyelvezet | „teszt”, „sportoló”, „gyakorlat” |

### A pontszám azonossága

A három pontszámnév ugyanazt a 0–1000 skálát takarja, azonos képlettel. Ez
szándékos: kutatási célra a három terület futásai így összevethetők maradnak,
miközben a felhasználó a saját világának megfelelő szót látja. A `runs` táblában
a `domain` mező őrzi meg, melyik arculaton keletkezett az adat.

---

## 3. A MODULKATALÓGUS — 19 MODUL

Minden modul **1–3 területhez** kötődik, `primary` vagy `secondary` relevanciával.
A kezdőtér csak a releváns modulokat mutatja, elsődlegeseket elöl. A leképezést
a `packages/shared/src/modules.ts` tartja, és a szerver a `module_domain_relevance`
táblába szinkronizálja, hogy egy telepítés a saját katalógusát újrahangolhassa.

A **terület** (A/B/C = védelem / munka / sport) és a **változat** (A/B = alap /
térbeli) két külön dolog, csak a betűjelük esik egybe. Az utolsó oszlop a
változatokról szól.

| # | Kód | Cím | A | B | C | Állapot | Vált. |
|---|---|---|:-:|:-:|:-:|---|---|
| 01 | SIGNAL | Vizuális keresés & anomália-észlelés | ● | ● | ○ | **kész** | A + B |
| 02 | SPACE | Térbeli orientáció & mentális forgatás | ● | ● | ○ | **külső** | — |
| 03 | NAV | Navigáció & téri memória | ● | ○ | ○ | **kész** | eleve térbeli |
| 04 | REACT | Reakcióidő & pszichomotoros kontroll | ● | ● | ● | **kész** | A + B (B: VR) |
| 05 | MULTI | Többfeladatos terhelés | ● | ● | ○ | terv | — |
| 06 | WATCH | Éberség & perifériás figyelem | ● | ● | ○ | **kész** | eleve térbeli |
| 07 | PRESSURE | Teljesítmény kognitív nyomás alatt | ● | ● | ● | **kész** | A + B (B: VR) |
| 08 | HOLD | Válaszgátlás & impulzuskontroll | ● | ● | ● | **kész** | eleve térbeli |
| 09 | MEMORY | Munkamemória | ● | ● | ○ | **kész** | eleve térbeli |
| 10 | COMMAND | Csapat, problémamegoldás & vezetés | ● | ● | ○ | **kész** | A + B |
| 11 | ANTICIPATE | Időzítés & előrejelzés | ○ | ● | ● | **kész** | A + B |
| 12 | FIELD | Hasznos látómező & dinamikus látásélesség | ○ | ● | ● | **kész** | eleve térbeli |
| 13 | STEADY | Poszturális stabilitás & kéznyugalom | ○ | ● | ● | **kész** | eleve térbeli (csak VR) |
| 14 | RHYTHM | Motoros időzítés & ritmusszinkronizáció | — | ○ | ● | **kész** | eleve térbeli |
| 15 | ADAPT | Mozgástanulási ráta & vizuomotoros adaptáció | ○ | ● | ● | **kész** | eleve térbeli |
| 16 | HANDS | Finom manuális ügyesség | ○ | ● | ○ | terv | — |
| 17 | RISK | Kockázatvállalás & döntési stílus | ○ | ● | ● | terv | — |
| 18 | PROTOCOL | Eljárásrendi fegyelem & ellenőrzőlista | ○ | ● | — | terv | — |
| 19 | INTENT | Mozgásolvasás & szándékfelismerés | ○ | ○ | ● | terv | — |

● elsődleges · ○ másodlagos · — nem releváns

Területenkénti darabszám: **A: 18 · B: 19 · C: 18** modul.
Ebből **implementált: 14** (SIGNAL, NAV, REACT, WATCH, PRESSURE, HOLD, MEMORY,
COMMAND, ANTICIPATE, FIELD, STEADY, RHYTHM, ADAPT + SPACE külső modulként).

---

## 4. AZ EREDETI TÍZ MODUL

A 01–10 modulok leírása az 1.0 specifikációból változatlan tartalommal él tovább;
itt csak az összefoglalójuk és az új doménkötésük szerepel. A részletes
specifikációk külön dokumentumokban készülnek
(`docs/01-MODULE-SPEC-PROMPT.md` alapján).

### 01 — SIGNAL · Vizuális keresés & anomália-észlelés — **implementálva**
Öt blokk: jellemzőkeresés, konjunkciós keresés, többobjektumos követés,
változásészlelés, perifériás detekció központi terhelés alatt. A fő mutató a
**keresési meredekség** (ms/elem) és a két keresésfajta különbsége.
Részletes specifikáció: `docs/13-MODULE-01-SIGNAL.md`.
**A:** fenyegetés- és anomália-észlelés (felderítő, drónkezelő, őr).
**B:** hibafelismerés műszerfalon, gyártósoron, felvételen (légiirányító, minőségellenőr).
**C:** játéktér-olvasás, a szabad ember megtalálása mozgó ingerek között.
Fő metrikák: hit rate, false positive rate, keresési idő, pásztázási lefedettség.

### 02 — SPACE · Térbeli orientáció & mentális forgatás
Shepard–Metzler paradigma. **Külön rendszerként már elkészült**, a platform külső
modulként indítja (`https://mindview-vr.vercel.app/`), és az eredményt azonosító
alapján fűzi vissza a profilba.
**A:** térkép–terep megfeleltetés. **B:** műszaki-téri gondolkodás — sebész, fogorvos,
gépészmérnök, CAD-tervező. **C:** testséma és légtudat forgásos sportágakban.

### 03 — NAV · Navigáció & téri memória — **implementálva**
Útvonaltanulás, iránytartás, útvonal-visszaidézés csomópont-alapú procedurális
környezetben. Öt blokk: passzív bejárás, újrajárás előre és fordítva,
iránybecslés (JRD), útvonal-integráció tereptárgy nélkül, térkép–terep megfeleltetés.
A modul az **útvonaltudást** és a **felmérési tudást** külön méri.
Részletes specifikáció: `docs/14-MODULE-03-NAV.md`.

### 04 — REACT · Reakcióidő & pszichomotoros kontroll — **implementálva**
Öt blokk: egyszerű reakció, választásos reakció, célra mutatás, folyamatos követés,
kétkezes koordináció. Mindhárom területen elsődleges.
Részletes specifikáció: `docs/11-MODULE-04-REACT.md`.

### 05 — MULTI · Többfeladatos terhelés

**Cél.** Mennyivel romlik minden egyes részfeladat attól, hogy közben a többit is
csinálni kell — és hogyan osztja el a felhasználó a figyelmét, amikor nem futja
mindenre.

**Alapelv.** NASA MATB-II mintájára négy állomás fut egyidejűleg: kompenzációs
követés, rendszerfigyelés (skálák és jelzőfények), erőforrás-tartás (tartályszintek
szivattyúkkal) és hangkommunikáció (rádióhívás, ami néha nekünk szól). Mindegyik
állomás fut **egyedül is**, egy-egy rövid alapvonal-blokkban, és a modul fő mutatója
a kettő különbsége. Ez a `dual_task_cost` egyetlen becsületes definíciója: a
terhelés alatti teljesítmény önmagában nem mond semmit anélkül, hogy tudnánk, mire
képes ugyanaz az ember egy feladattal.

**Amit a térbeliség hozzátesz.** A MATB-II négy panele egy monitoron van, egyszerre
látható; a figyelem elosztása ott szemmozgás kérdése, amit nem tudunk mérni. Itt a
négy állomás **körbevesz**: legfeljebb kettő látszik egyszerre, tehát a figyelem
elosztása fejfordítássá válik — megfigyelhető és naplózható viselkedéssé. Ebből
születik a `station_dwell_entropy` (mennyire egyenletesen osztja el a felügyeletet)
és a `neglect_time` (a leghosszabb idő, amíg egy állomásra rá sem nézett).

**Vizsgált képességek:** megosztott figyelem, többfeladatosság, feladatváltás,
információs túlterhelés, dual-task cost, beszédértés zajban.

**Fő metrikák:** `dual_task_cost` állomásonként, `tracking_rms`,
`monitor_hit_rate`, `audio_hit_rate`, `station_dwell_entropy`, `neglect_time_s`.

**Doménkötés.**
**A (elsődleges):** harcálláspont- és járművezetői terhelés — rádió, műszer,
célkövetés és döntés egyszerre.
**B (elsődleges):** légiirányítás, mentésirányítás, aneszteziológia: a párhuzamos
csatornák kezelése a munkakör lényege, nem mellékkörülménye.
**C (másodlagos):** osztott figyelem csapatsportban.

**Mobil.** Támogatott, de a körülvevő elrendezés ±34°-ra szűkül, és a
figyelemelosztási mutatók (`station_dwell_entropy`, `neglect_time_s`) **hiányoznak**,
mert nincs fejirány. A négy állomás vezérlése a vezérlősávra kerül.

**Asset igény:** 1/5 · **Programozási komplexitás:** 4/5

### 06 — WATCH · Éberség & perifériás figyelem — **implementálva**
A résztvevő egy **teljes 360°-os, 32 emitteres rács közepén** áll; a fények
szinkronban pulzálnak, és a ritka kilépéseket kell elkapni. Ebből olyan mérések
jönnek, amiket sík kijelzőn nem lehet elvégezni: **térbeli lefedettség**,
**hátsó szektor detekciója**, **mélységi költség**, és a lefedettség időbeli
szűkülése (`scan_shrinkage`) — az éberség-lejtés térbeli megfelelője.
Részletes specifikáció: `docs/17-MODULE-06-WATCH.md`.
Kiemelt mutató a **vigilance decrement**.
**A:** őr- és megfigyelőszolgálat. **B:** műszakos éberség, vezérlőterem, hosszú vezetés.
**C:** sportlövészet, íjászat, ultra-távú versenyek.

### 07 — PRESSURE · Teljesítmény kognitív nyomás alatt — **implementálva**
Öt blokk: alapvonal, interferencia, feladatváltás, nyomás (rövidülő határidő +
zavaró hang + tétszámláló + szabály-megfordítás), helyreállás. Minden fő mutató
személyen belüli különbség: a nyomás alatti romlást és a helyreállást a résztvevő
saját alapvonalához mérjük. **Nem** trauma-szimuláció — a terhelés időnyomás,
zavaró hang, látható tét és szabályváltás.
Kiemelt mutató a **post-error recovery** és a **rule-change cost**.
Részletes specifikáció: `docs/15-MODULE-07-PRESSURE.md`.
**A:** döntési képesség terhelés alatt. **B:** krízisteljesítmény (sürgősségi ellátás,
légiirányítás). **C:** versenyhelyzeti stabilitás — a „choking under pressure”
mérhető közelítése.

### 08 — HOLD · Válaszgátlás & impulzuskontroll — **implementálva**
A testek **feléd repülnek** a térben, forogva: a határidő fizikai (a tárgy
odaér), és a döntés folyamatosan érik, tehát az elköteleződés pillanata maga is
mutató. Négy blokk: go/no-go, **stop-jel SSRT-lépcsővel**, pályaítélet
(csak arra reagálj, ami eltalálna — mélységi döntés), és szabályváltás.
Az SSRT az egyetlen mutató a platformon, ami a gátlásnak **látenciát** ad.
Embermodell, fegyver és civil ábrázolás nélkül.
Részletes specifikáció: `docs/18-MODULE-08-HOLD.md`.
**A:** tűzmegnyitási fegyelem absztrakt megfelelője. **B:** biztonsági önfegyelem,
elhamarkodott beavatkozás visszatartása. **C:** cselezés-ellenállás, fegyelmezett rajt.

### 09 — MEMORY · Munkamemória — **implementálva**
**Térfogatban** elhelyezett kockák — három mélységi rétegben, a résztvevő körül —,
nem táblán. Öt blokk: adaptív 3D Corsi, **térbeli frissítés** (a tömb a
sötétedés alatt észrevétlenül elfordul, és az új helyzetben kell felidézni),
tárgy-hely kötés csere-hiba elemzéssel, térbeli 2-back csalikkal, és felidézés
téri-motoros interferencia után.
Részletes specifikáció: `docs/19-MODULE-09-MEMORY.md`.
**A:** parancsmegtartás, koordináta és hívójel pontos visszaadása.
**B:** gyógyszeradagolás, ellenőrzőlista, ügyfélinformáció fejben tartása.
**C:** taktikai utasítás és koreográfia felidézése.

### 10 — COMMAND · Csapat, problémamegoldás & vezetés — **implementálva**
2–5 fő, megosztott információ, közös terv; egy kör vezető nélkül, egy kör kijelölt
parancsnokkal. Részletes specifikáció: `docs/12-MODULE-10-COMMAND.md`.

---

## 5. AZ ÚJ KILENC MODUL (11–19)

Ezek azért kerültek be, mert a sport és a munkaalkalmasság olyan konstruktumokat
igényel, amelyeket a védelmi katalógus nem fedett le. Mindegyik ugyanabban a
formátumban van összefoglalva, mint az eredeti tíz.

### 11 — ANTICIPATE · Időzítés & előrejelzés

**Cél.** Mozgó objektum érkezési idejének előrejelzése akkor is, amikor az objektum
az utolsó szakaszon már nem látható.

**Alapelv.** Egy gömb egyenletes sebességgel halad egy jelölt becsapódási pont felé,
majd útközben eltűnik (időbeli okklúzió). A felhasználónak pontosan akkor kell
reagálnia, amikor az objektum elérné a célt. Ez a koincidencia-időzítés klasszikus
Bassin-féle paradigmájának VR-változata, kiegészítve sebességváltozásokkal és
változó okklúziós hosszal.

**Vizsgált képességek:** koincidencia-időzítés, ütközési idő (time-to-contact)
becslése, mozgás-extrapoláció, sebesség-megkülönböztetés, időbeli előrejelzés.

**VR környezet.** Semleges tér, egyetlen mozgó gömb, egy jelölt célsík, halvány
sebességvonalak. Négy blokk: látható pálya, rövid okklúzió (30%), hosszú okklúzió (60%),
sebességváltás okklúzió alatt.

**Fő metrikák:** időzítési hiba előjellel (konstans hiba: siet vagy késik),
időzítési szórás (variábilis hiba), abszolút hiba, okklúziós robusztusság
(a hiba növekedése az okklúzió hosszával), sebességváltás-érzékenység.

**Doménkötés.**
**C (elsődleges):** az ütő-, dobó- és elkapósportok legfontosabb percepciós képessége —
teniszfogadás, baseball, krikett, asztalitenisz, röplabda. Az okklúziós változat azt
méri, amit a valóság kikényszerít: a labda utolsó szakaszát a játékos már nem látja.
**B (elsődleges):** féktávolság- és előzésbecslés, daru- és targoncakezelés.
**A (másodlagos):** mozgó cél előretartása, konvojtávolság.

**Asset igény:** 1/5 · **Programozási komplexitás:** 3/5
**Állapot: implementálva.** Részletes specifikáció: `docs/16-MODULE-11-ANTICIPATE.md`.

---

### 12 — FIELD · Hasznos látómező & dinamikus látásélesség

**Cél.** Mennyit vesz észre a felhasználó a periférián anélkül, hogy a központi
feladatról levenné a figyelmét — és hogyan szűkül ez terhelés alatt.

**Alapelv.** Kettős feladat: a középen megjelenő alakzat azonosítása mellett egy
rövid (50–300 ms) felvillanás helyét kell megjelölni növekvő excentricitáson
(10°, 20°, 30°, 40°), zavaró háttérrel és anélkül. A felvillanás hosszát adaptívan
csökkentjük, amíg meg nem találjuk a küszöböt. Ez a Useful Field of View paradigma
VR-adaptációja.

**Vizsgált képességek:** hasznos látómező, perifériás észlelés, megosztott figyelem,
dinamikus látásélesség, látómező-szűkülés terhelés alatt.

**VR környezet.** Sötét tér, központi fixációs alakzat, körkörösen elhelyezett
perifériás pozíciók, opcionális disztraktor-mező.

**Fő metrikák:** UFOV-küszöb ezredmásodpercben, perifériás pontosság
excentricitásonként, központi feladat költsége (mennyivel romlik a központi
teljesítmény, amikor perifériás inger is van), dinamikus látásélesség pontszám.

**Doménkötés.**
**B (elsődleges):** a UFOV a közúti balesetek egyik legerősebb validált percepciós
előrejelzője, különösen idősebb és fáradt vezetőknél — hivatásos sofőr, buszvezető,
gépkezelő, idősvezetői felülvizsgálat.
**C (elsődleges):** a „jó játéklátás” nagyrészt hasznos látómező — labdarúgó irányító,
kosárlabda-átlövő, kézilabda-irányító, jégkorong.
**A (másodlagos):** perifériás helyzetfelismerés, a látómező stressz alatti beszűkülése.

**Asset igény:** 1/5 · **Programozási komplexitás:** 3/5

---

### 13 — STEADY · Poszturális stabilitás & kéznyugalom

**Cél.** A testlengés és a kéztremor objektív mérése a headset és a kontrollerek
6DoF adatából, külön műszer nélkül.

**Alapelv.** Az eredeti specifikáció az egyensúlyt kizárta (`95 Balance — X`), mert
külön eszközt feltételezett. A Quest 3 fejkövetése viszont milliméteres felbontású
poszturográfiára alkalmas. Négy állapot: nyitott szemmel álló helyzet, „csukott szem”
(elsötétített kijelző), egy lábon állás, vizuális perturbáció (lassan mozgó
környezeti minta). Külön blokk a kéznyugalomra: célon tartás karnyújtva, 30 s.

**Vizsgált képességek:** poszturális stabilitás, egyensúly, vizuális függés,
kéznyugalom / tremor, szenzomotoros integráció.

**Fő metrikák:** lengéspálya hossza (mm), 95%-os konfidencia-ellipszis területe,
Romberg-hányados (csukott/nyitott szem arány), vizuális perturbációra adott
válasz amplitúdója, kéz-RMS tremor és annak domináns frekvenciája.

**Doménkötés.**
**B (elsődleges):** magasban végzett munka, sebészi és fogászati kéznyugalom,
mikroelektronikai szerelés, laboratóriumi munka.
**C (elsődleges):** egyensúly-domináns sportágak szűrése, és — kiemelten —
**agyrázkódás utáni visszatérési protokoll** objektív mérőszáma.
**A (másodlagos):** lövészstabilitás, terhelt menet utáni egyensúly.

**Biztonsági megjegyzés.** Egy lábon állás VR-ben eleséskockázat. A modul kötelezően
kéri a szabad tér megerősítését, és a felügyelő jelenlétét feltételezi.

**Asset igény:** 1/5 · **Programozási komplexitás:** 2/5 · **Csak VR** (`vr-only`)

---

### 14 — RHYTHM · Motoros időzítés & ritmusszinkronizáció

**Cél.** Mennyire pontosan tud a felhasználó külső ütemhez igazodni, és mennyire
stabilan tartja a tempót, amikor az ütem megszűnik.

**Alapelv.** Szinkronizációs-folytatásos paradigma: 30 ütemre igazodás
(400 ms, 600 ms, 800 ms IOI), majd az ütem elnémítása után 30 ütem tartása.
Kiegészítve tempóváltással és keresztritmussal (bal kéz 2, jobb kéz 3 ütem).

**Vizsgált képességek:** motoros időzítés, ritmusszinkronizáció, belső óra
stabilitása, kétkezes koordináció, tempóadaptáció.

**Fő metrikák:** átlagos aszinkrónia (jellemzően negatív — az emberek megelőzik az
ütemet), aszinkrónia szórása, tempódrift a folytatásos szakaszban, keresztritmus
pontosság.

**Doménkötés.**
**C (elsődleges):** az evezés, úszás, futás és gátfutás gazdaságosságát a ritmus
stabilitása határozza meg; a szinkron sportágakban ez maga a teljesítmény —
szinkronúszás, ritmikus gimnasztika, tánc.
**B (másodlagos):** gyártósori ütemtartás, zenei és előadóművészi pályák.
**A:** nem releváns; az adatot gyűjtjük, de a védelmi kezdőtéren nem jelenítjük meg.

**Asset igény:** 1/5 · **Programozási komplexitás:** 2/5

---

### 15 — ADAPT · Mozgástanulási ráta & vizuomotoros adaptáció

**Cél.** Nem azt méri, milyen jó valaki most, hanem azt, **milyen gyorsan javul**.

**Alapelv.** Vizuomotoros rotációs adaptáció: a kéz és a látott kurzor közé rejtett
30°-os elforgatás kerül. A felhasználó eleinte mellétalál, majd fokozatosan
kompenzál. A torzítás megszűnésekor mért **utóhatás** mutatja meg, mennyi épült be
implicit módon. A második expozíció **savings** mutatója azt méri, mennyit őrzött meg.

Négy fázis: alapvonal (40 próba) → adaptáció (80 próba, 30° rotáció) →
washout (30 próba, rotáció nélkül) → újratanulás (40 próba, ugyanaz a rotáció).

**Vizsgált képességek:** mozgástanulási ráta, vizuomotoros adaptáció, utóhatás
nagysága, savings, explicit/implicit tanulás aránya.

**Fő metrikák:** adaptációs időállandó (hány próba alatt éri el a plató 63%-át),
aszimptotikus hiba, utóhatás nagysága fokban, savings index.

**Doménkötés.**
**B (elsődleges):** a legtöbb alkalmassági teszt a pillanatnyi szintet méri; ez a
**betaníthatóságot** — laparoszkópos sebészet, távirányított gépkezelés,
CNC-betanulás, és pályaorientáció.
**C (elsődleges):** tehetségazonosításban a jelenlegi teljesítménynél többet mond,
ki javul gyorsabban ugyanannyi ismétlésből.
**A (másodlagos):** új fegyverrendszerre vagy kezelőfelületre való átállás sebessége.

**Asset igény:** 1/5 · **Programozási komplexitás:** 3/5

---

### 16 — HANDS · Finom manuális ügyesség

**Cél.** Apró elemek pontos megfogása, áthelyezése és szűk pályán való átvezetése,
két kézzel.

**Alapelv.** Pegboard-logika VR-ben: pálcikák beillesztése furatokba (egy kézzel,
másik kézzel, két kézzel egyszerre), majd egy hajlított pálya végigkövetése úgy,
hogy a fogott elem ne érjen a falhoz („buzz-wire”). Végül összeszerelési feladat:
két elem egymáshoz illesztése adott orientációban.

**Vizsgált képességek:** manuális ügyesség, finommotoros pontosság, kétkezes
koordináció, fogásprecizitás, mozgássimaság.

**Fő metrikák:** beillesztés / perc, falérintések száma, mozgás-jerk (a gyorsulás
deriváltjának integrálja — a mozgás simaságának standard mérőszáma), kezek közti
aszimmetria.

**Doménkötés.**
**B (elsődleges):** a pegboard-típusú tesztek a manuális szakmák bevált szűrőeszközei;
VR-ben eszközkopás nélkül, automatikus méréssel — sebész, fogorvos, órás,
elektronikai szerelő, fodrász, szakács.
**C (másodlagos):** sportlövészet, íjászat, biliárd, e-sport.
**A (másodlagos):** szerelés, hibaelhárítás, kesztyűben végzett finommunka.

**Megjegyzés.** Kézkövetéssel (hand tracking) érvényesebb, mint kontrollerrel; a
modul mindkettőt támogatja, de a `comparability` kulcs elkülöníti őket.

**Mobil és asztali.** Nincs. Ez az egyetlen modul, amelynek minden mutatója a
6DoF követésből származik: egy egérrel húzott pálcika nem ugyanazt méri, és a
`path_jerk` értelmezhetetlen egy olyan eszközön, ahol a mozgás felbontása a
képernyő pixelrácsa. A kezdőtér ilyenkor magyarázatot ír ki, nem leromlott
változatot kínál.

**Asset igény:** 1/5 · **Programozási komplexitás:** 3/5 · **Csak VR**

---

### 17 — RISK · Kockázatvállalás & döntési stílus

**Cél.** A megfigyelt döntési viselkedés leírása ismételt nyereség-veszteség
helyzetekben. **Nem** személyiségteszt.

**Alapelv.** BART-szerű feladat: egy növekvő objektum minden lépésnél többet ér, de
minden lépésnél nő az elvesztés valószínűsége. A felhasználó dönt, mikor áll meg.
Kiegészítve egy Iowa-szerű blokkal, ahol négy opció rejtett nyereség/veszteség
eloszlása csak tapasztalatból tanulható meg.

**Vizsgált képességek:** kockázatvállalási viselkedés, kockázatértékelés, döntés
bizonytalanságban, visszajelzés alapú tanulás, veszteségkövetés.

**Fő metrikák:** korrigált kockázati index (az átlagos lépésszám azokban a
próbákban, ahol nem következett be veszteség), tanulási meredekség, veszteségkövetési
index (a veszteség utáni kockázatnövelés), döntési konzisztencia.

**Doménkötés.**
**B (elsődleges):** munkabiztonsági szabályszegés és pénzügyi kockázatvállalás
egyaránt visszavezethető a visszajelzésből való tanulás mintázatára.
**C (elsődleges):** taktikai kockázatvállalás — kerékpáros szökés, sziklamászás,
síugrás, motorsport.
**A (másodlagos):** a szélsőségek érdekesek: a túl konzervatív és a túl vakmerő
döntéshozó egyaránt kockázat.

**Térbeliség.** A BART és az Iowa paradigma önmagában nem térbeli — ezt a
`03-SPATIAL-DESIGN.md` laposítási tesztje kimondja. A modul ezért nem a látványt
teszi 3D-be, hanem a **tétet hozza karnyújtásnyira**: a növekvő test a
peripersonalis térben tágul, a kifutás pillanata fizikailag közeledik, és a
megállás elköteleződése folyamatosan megfigyelhető (a HOLD `commitment_fraction`
mintájára). Az Iowa-blokk négy opciója négy különböző irányban és mélységben áll,
így a választás mozdulat, nem kattintás — a `approach_hesitation` és a
`reach_reversal_rate` sík platformon hiányzik.

**Etikai megjegyzés.** Az eredmény megfogalmazása kötelezően viselkedésleíró
(„megfigyelt kockázatvállalás ebben a feladatban”), soha nem jellemvonás.
A modul nem ad „kockázatvállalási pontszámot” rangsorként: a szélsőségek mindkét
irányban jelzésértékűek, és az eredményképernyő ezt kimondja.

**Mobil.** Támogatott. A pumpálás és a megállás vezérlősávi gomb, az Iowa-opciók
a `dial` négy szegmense. A nyúlásalapú mutatók hiányoznak.

**Asset igény:** 1/5 · **Programozási komplexitás:** 2/5

---

### 18 — PROTOCOL · Eljárásrendi fegyelem & ellenőrzőlista

**Cél.** Több lépéses eljárás pontos, sorrendhelyes végrehajtása időnyomás,
megszakítás és menet közbeni eljárásmódosítás mellett.

**Alapelv.** A felhasználó megtanul egy 8–12 lépéses absztrakt eljárást
(kapcsolók, szelepek, visszaigazolások adott sorrendben), majd többször végrehajtja.
A második végrehajtás közben megszakítás érkezik (egy másik, rövid feladat), és mérjük,
hol veszi fel a fonalat. A harmadiknál az eljárás egy lépése megváltozik.

**Vizsgált képességek:** eljáráskövetés, prospektív memória, megszakítás utáni
helyreállás, szabálymegtartás, sorrendmemória.

**Fő metrikák:** kihagyott lépések száma, sorrendhibák száma, felvételi késleltetés
(resumption lag — a megszakítás után az első helyes lépésig eltelt idő),
protokollkövetés időnyomás alatt.

**Doménkötés.**
**B (elsődleges):** a repülésben és az egészségügyben a súlyos hibák többsége
kihagyott ellenőrzőlista-lépés megszakítás után. Ez a modul ezt méri, nem az
elméleti tudást — pilóta, ápoló, gyógyszerész, vegyipari operátor.
**A (másodlagos):** fegyverellenőrzés, rádióeljárás, ellenőrzőpont-protokoll.
**C:** nem jelenítjük meg alapból.

**Térbeliség.** Az eljárás állomásai **körbeveszik** a felhasználót, tehát az
ellenőrzőlista soha nem látható egészben. Ez nem díszlet: a megszakítás utáni
helyreállás valódi költsége részben az, hogy vissza kell találni ahhoz az
állomáshoz, ahol abbahagytuk. A `resumption_lag` így két összetevőre bomlik —
`reorientation_time` (mennyi idő, amíg a helyes állomás felé fordul) és
`decision_time` (mennyi idő, amíg a helyes lépést kiválasztja) —, és ez a bontás
sík platformon nem létezik.

**Mobil.** Támogatott, ±34°-os elrendezéssel és húzásos körbenézéssel; a
`reorientation_time` mobilon a mutató elfordulásából származik, tehát **más néven**
kerül a naplóba (`pointer_reorientation_time`), és nem keveredik a VR-értékkel.

**Asset igény:** 1/5 · **Programozási komplexitás:** 3/5

---

### 19 — INTENT · Mozgásolvasás & szándékfelismerés

**Cél.** Az ellenfél vagy a másik ember szándékának korai felismerése a mozdulat
kinematikájából.

**Alapelv.** Egy absztrakt pontfény-alak (point-light figure: 13–15 gömb az ízületek
helyén, procedurálisan animálva) mozdulatot kezd, majd a mozdulat egy pontján eltűnik.
A feladat a szándék irányának megjóslása. Az okklúzió időpontját próbáról próbára
korábbra hozzuk, így megkapható a **legkorábbi megbízható időpont**. A próbák egy
része megtévesztés (cselezés): a kezdő kinematika mást ígér, mint a végkifejlet.

**Vizsgált képességek:** biológiai mozgás észlelése, cselekvés-előrejelzés,
megtévesztés felismerése, kinematikai jelzések használata, helyzetértékelés.

**Fő metrikák:** előrejelzési pontosság okklúziós időpontonként, legkorábbi
megbízható időpont (ahol a teljesítmény még szignifikánsan a véletlen felett van),
megtévesztésre való érzékenység, magabiztosság-kalibráció (mennyire tudja a
felhasználó, hogy mikor téved).

**Doménkötés.**
**C (elsődleges):** az elit sportoló nem gyorsabban reagál — hamarabb tud. A korai
kinematikai jelzések olvasása a legjobban dokumentált szakértői előny a
sportpszichológiában: kapus, vívás, tenisz, küzdősportok.
**A (másodlagos):** szándékfelismerés testtartásból ellenőrzőponton és tömegben.
**B (másodlagos):** gyalogos lelépési szándékának előrejelzése vezetés közben.

**Térbeliség.** A pontfény-alak **testméretű és egy karnyújtásnyira áll**, nem egy
képernyőn. Három mérés következik ebből, amit sík kijelző nem tud: az alak
**feléd** indul vagy melléd (mélységi szándék, ami csak diszparitásból és
parallaxisból olvasható), az alak **oldalt** is megjelenhet (perifériás
kinematikaolvasás), és a nézőpont próbánként **eltolható** (ugyanaz a mozdulat
oldalról más kinematikai jelzést ad, mint szemből).

**Asset igény:** 2/5 — az egyetlen modul, amely mozgásadatot igényel; a pontfény-alak
procedurálisan generálható, a mozdulatok kinematikáját paraméteresen modellezzük
(nincs mocap-felvétel, és nincs is rá szükség: a manipulált változó maga a
kinematikai paraméter). **Programozási komplexitás:** 3/5

**Mobil.** Támogatott. A válasz a `dial` iránygombjaival, a magabiztosság a
`slider`-rel érkezik. A mélységi és perifériás alblokk mobilon nem fut, a hozzájuk
tartozó mutatók hiányoznak.

---

## 6. AZ AI VIZSGÁLATVEZETŐ (PHASE 2)

**Cél.** A vizsgálatvezető egy szöveges (később hangos) asszisztens, amely a modulok
**között** kíséri a felhasználót. Nem a feladat közben — mérés alatt bármilyen
segítség érvényteleníti a mérést.

**Négy funkció.**

1. **Fogadás és tájékoztatás.** Elmagyarázza, mi következik, mennyi ideig tart,
   mit fog látni. Kérdezhető: „mit mér ez pontosan?”, „muszáj belépnem?”.
2. **Megértés ellenőrzése.** A gyakorlóblokk után rákérdez, mi a szabály. Ha a
   válasz hibás, megismételteti a gyakorlást. Ez a leggyakoribb hibaforrás
   felügyelet nélküli mérésnél: a résztvevő nem értette a feladatot, de kattintott.
3. **Következő modul javaslata.** A profil hiányzó tengelyei és a terület alapján:
   „a figyelmi tengelyen még nincs adatod, a WATCH tizenöt perc”.
4. **Szöveges összefoglaló.** A futás után emberi nyelven elmondja, mit jelentenek
   a számok — a megengedett megfogalmazási kereteken belül (lásd 12. fejezet).

**Architektúra.** A vizsgálatvezető a `ConductorService` interfészen keresztül
kapcsolódik, amely a következőt kapja meg: terület, profil-összegzés, az utolsó
futás metrikái, és a katalógus. Nem kap nyers eseménynaplót és nem kap
személyazonosító adatot. A válasza sablonozott: szabadszöveges generálás csak a
magyarázó részben, a javaslati rész strukturált.

**Korlátok, amelyek nem tárgyalhatók.**
- A vizsgálatvezető **nem ad diagnózist és nem ad alkalmassági ítéletet.**
- **Nem beszél mérés közben** — a chat panel assessment módban zárolva van.
- Minden általa írt szöveg naplózásra kerül a futás mellé, mert az instrukció
  része a mérési feltételeknek.

**Állapot.** A kezdőtéren a felület helye megvan, letiltott állapotban, „Phase 2”
jelöléssel. A beszélgető réteg a második fázisban készül el.

---

## 6/B. A TÉRBELISÉG KIHASZNÁLÁSA

Egy VR-modul akkor rossz, ha egy sík tesztet vetít ki egy térbeli falra.
A platform ezért kimondja, mit jelent a harmadik dimenzió használata, és
minden új modulnak ezt kell alkalmaznia (`packages/client/src/modules/shared/volume.ts`).

**Négy eszköz, mindegyikhez tartozó méréssel.**

| Eszköz | Mit tesz lehetővé | Példa mérés |
|---|---|---|
| **Körülvevő elrendezés** (360°) | a fejfordítás maga a feladat, nem melléktermék | `head_scan_entropy`, `scan_shrinkage`, `rear_hit_rate` (WATCH) |
| **Mélység mint önálló csatorna** | a szögméretet állandóan tartjuk, így a távolságot csak a diszparitás és a parallaxis hordozza | `depth_cost` (WATCH), `depth_confusion_rate` (MEMORY) |
| **Közeledés / pálya** | a határidő fizikai, a döntés folyamatosan érik | `commitment_fraction`, `trajectory_d_prime` (HOLD) |
| **Forgás és rejtett transzformáció** | a testek tömör testként olvashatók; a tárolt elrendezésre transzformáció alkalmazható | `updating_cost` (MEMORY), tumbling minden modulban |

**A becsületesség szabálya.** Ha egy mérés a térbeliségből származik, akkor
sík platformon **nem szabad helyette közelítést adni**. A metrika hiányzik
(nem nulla), a súlya nulla, és az eredményképernyő kiírja, hogy VR kell hozzá.
Egy 0,72-es asztali pontszám és egy 0,72-es VR pontszám nem ugyanaz, és a
rendszer nem tehet úgy, mintha az lenne.

A teljes doktrína — a hat térbeli affordancia, a **laposítási teszt**, és ami
**nem** számít térbeliségnek — külön dokumentumban: **`docs/03-SPATIAL-DESIGN.md`**.
Ez a modulspecifikáció-generátor kötelező olvasmánya, és minden új modul
átvételi feltétele.

---

## 6/C. A ÉS B VÁLTOZATOK

A már elkészült modulok utólagos átvizsgálásakor öt modul bukott meg a
laposítási teszten: **SIGNAL, REACT, PRESSURE, COMMAND, ANTICIPATE**. Ezek
szakmailag érvényes tesztek — csak nem térbeliek: minden metrikájuk
változatlan maradna egy monitoron.

A megoldás nem az volt, hogy lecseréljük őket, hanem hogy **mindegyik kapott
egy B változatot**: ugyanaz a konstruktum, ugyanaz a szakmai alap, de olyan
paradigmában, ami a harmadik dimenziót ténylegesen méri.

| Modul | A változat | B változat | A B mérése, ami A-ban nem létezik |
|---|---|---|---|
| **SIGNAL** | felületi keresés | **térfogati keresés** | `depth_guidance_benefit`, `rotation_search_cost`, `occlusion_tracking_cost` |
| **REACT** | gombos RT, sugárral mutatás | **nyúlás és elfogás** (csak VR) | `fitts_slope_3d`, `tracking_depth_dominance`, `bimanual_depth_asynchrony` |
| **PRESSURE** | időnyomás alatti döntés | **térbeli interferencia és figyelmi szűkülés** (csak VR) | `depth_simon_effect`, `attentional_narrowing_slope` |
| **COMMAND** | rejtett profil kártyákkal | **szerkezetleltár nézőpontokból** | `pooling_gain`, `privileged_blocks`, `allocentric_ratio` |
| **ANTICIPATE** | oldalirányú anticipáció | **ütközésig hátralévő idő (tau)** | `size_arrival_effect`, `tau_reliance` |

A NAV, WATCH, HOLD és MEMORY modulok már eleve térbeliek, ezért **nem kaptak
B változatot** — egy változat elég belőlük.

**A 12–15. modul (FIELD, STEADY, RHYTHM, ADAPT) eleve a térbeliségre épült**,
ezért ezeknek sincs A/B párjuk. Mindegyik a saját szakterületének ismert
paradigmájából indul, és annak térbeli kiterjesztése:

| Modul | A klasszikus paradigma | Amit a térbeliség hozzátesz |
|---|---|---|
| **FIELD** | Useful Field of View (Ball & Owsley) | a mért mennyiség maga egy szögtartomány, és egy monitor ±16°-nál elvágja; 50°-ig mérünk, mélységi altesztzel és fejpózból ellenőrzött fixációval |
| **STEADY** | poszturográfia + Romberg + mozgó szoba | a mérőműszer maga a térbeli követés; a mozgó szoba körülvevő optikai áramlás, ami síkon nem létezik |
| **RHYTHM** | szinkronizációs-folytatásos kopogás | a térben mozgó ütemjelzés előnye a villanáshoz képest, és ennek ára mélységi és perifériás pályán |
| **ADAPT** | vizuomotoros rotációs adaptáció | valódi karmozgás, és az elevációs próbapontok: általánosít-e a tanulás a betanított síkon kívülre |

**Szabályok.**

1. Az A változat **megmarad és futtatható**. A B nem váltja le, kiegészíti.
2. A választás a felhasználóé: a modulkártya alján **A / B gomb**.
3. A két változat `config_version`-je különbözik (`<CODE>_STANDARD_A` /
   `<CODE>_SPATIAL_B`), ezért a **normacsoportjaik és a személyes rekordjaik
   soha nem keverednek**. A `runs.variant` oszlop és a `personal_bests` nézet
   `config_version` szerinti bontása ezt garantálja.
4. Ha egy B változat VR-t igényel, lapos platformon a gomb **letiltva és
   megindokolva** jelenik meg. A rendszer soha nem indít csendben degradált
   verziót helyette.
5. Minden B változat **publikált paradigmán alapul**, annak térbeli
   megvalósításaként — nem a látvány kedvéért térbeli.

A B változatok részletes specifikációja az egyes modulok dokumentumának
végén, „B VÁLTOZAT” fejezetként található.

---

## 7. TECHNOLÓGIAI ALAPELVEK

### 7.1. WebXR first
A rendszer elsődlegesen WebXR alkalmazás: weboldalból indítható immerzív VR
munkamenet a Meta Quest böngészőben. A WebXR szabvány külön kezeli az inline és az
`immersive-vr` futást, így ugyanaz a webalkalmazás megfelelő UI-réteggel headset
nélkül is használható.

### 7.2. HTTPS kötelező
Az immerzív munkamenet biztonságos kontextushoz és felhasználói gesztushoz kötött;
a böngésző nem léphet magától VR-be. A folyamat ezért mindig:

```
kezdőoldal → ENTER VR gomb → felhasználói kattintás → WebXR munkamenet
```

### 7.3. Egy motor egyszer indul
Az `Engine` a lap élettartama alatt egyszer jön létre, és a jelenetek alatta
cserélődnek. Ennek gyakorlati oka van: minden újbóli belépés az immerzív
munkamenetbe új felhasználói gesztust igényel, tehát a headsetből kilépni és
visszamenni modulváltáskor elfogadhatatlan lenne.

### 7.4. Tényleges technológiai stack

| Réteg | Választás | Indoklás |
|---|---|---|
| Frontend | TypeScript + Vite + **Three.js** (közvetlenül) | Az A-Frame deklaratív rétege elrejti a frame-időzítést; a reakcióidő-mérésnek pontos kontroll kell az XR frame ciklus felett. |
| 3D UI | canvas-textúrás panelek + raycast | Egy UI-implementáció mindhárom platformra. |
| Backend | Node.js + TypeScript + **Fastify** | Kis felület, jó TS-támogatás, beépített WebSocket plugin. |
| Adatbázis | **PostgreSQL** (Coolify-kezelt, Hetzner szerver) | JSONB az eseménynaplókhoz, natív percentilis-függvények az elemzéshez. |
| Realtime | `@fastify/websocket` (ws) | A COMMAND szobák memóriában élnek, az eredmény és a teljes átirat DB-be kerül. |
| Hang | Web Audio API, futásidejű szintézis | Nulla audio asset; az inger paraméterrel definiált, nem felvétellel. |
| Voice (opcionális) | WebRTC mesh, a szoba WebSocketje a jelzéscsatorna | Max 5 fő = 10 kapcsolat, SFU nélkül elég. |

---

## 8. PLATFORM ARCHITEKTÚRA

```
WEB APPLICATION SHELL  (2D DOM: területválasztás, kezdőtér, belépés)
        │
        ▼
ENGINE  (WebGL renderer, XR munkamenet, frame loop, óra)
        │
 ┌──────┼──────────┬──────────────┐
 ▼      ▼          ▼              ▼
RENDER  INPUT      3D UI          AUDIO
        (absztrakt (canvas panel  (szintetizált,
         akciók)    + raycast)     térbeli)
        │
        ▼
ASSESSMENT ENGINE  (TrialMachine, ModuleRunner, RNG seed, difficulty)
        │
        ▼
DATA / EVENT LOGGER  (esemény + mozgásnapló, offline puffer)
        │
        ▼
SCORING ENGINE  (nyers → származtatott → score → OPS)
        │
        ▼
API + POSTGRESQL  (runs, trials, events, metrics, scores, teams)
```

---

## 9. AZ ASSESSMENT ENGINE

### 9.1. Terminológia

| Fogalom | Jelentés |
|---|---|
| **Construct** | Az emberi képesség, amit mérni akarunk (munkamemória, éberség). |
| **Task** | A konkrét feladat (piros gömb megjelenésekor válasz). |
| **Trial** | Egyetlen mérési esemény. |
| **Run** | Egy modul egy teljes végrehajtása. |
| **Session** | Egy alkalommal végzett futások összessége. |
| **Metric** | Nyers vagy számított mérési eredmény. |
| **Score** | A metrikákból származtatott, normalizált érték. |

### 9.2. Szabvány trial-állapotgép

Minden modul minden próbája ugyanezt a szerkezetet használja:

```
PREPARE → COUNTDOWN → STIMULUS → RESPONSE WINDOW → RESPONSE
       → FEEDBACK (opcionális) → INTER-TRIAL → következő
```

Az állapotgépet a render loop lépteti, tehát minden fázishatár egy frame-re esik —
pontosan arra a frame-re, amelyen a résztvevő először láthatta a változást.

### 9.3. Szabvány modul-folyamat

```
MODULVÁLASZTÁS → INTRO → INSTRUKCIÓ → KALIBRÁCIÓ → GYAKORLÁS
              → „MOST JÖN A MÉRÉS” → MÉRÉS → FELDOLGOZÁS
              → EREDMÉNY → MENTÉS → vissza a kezdőtérbe
```

A **gyakorlás és a mérés szétválasztása kötelező.** Gyakorlás közben van
visszajelzés; mérés közben nincs se visszajelzés, se élő pontszám, se streak.
Csak a mérés kerül a hivatalos eredménybe.

### 9.4. Random seed
Minden futás kap egy seedet, és tárolja. Ugyanaz a seed ugyanazt az ingersorrendet
adja, tehát a futás reprodukálható, debugolható, és két résztvevőnek adható
pontosan azonos feladat. Ismételt mérésnél viszont **más seed kell**, azonos
nehézség mellett, hogy a sorrend megtanulása ne javítsa látszólag a teljesítményt.

### 9.5. Két futási mód

| | ASSESSMENT | CHALLENGE |
|---|---|---|
| Cél | standardizált mérés | gyakorlás és verseny |
| Konfiguráció | rögzített | adaptív |
| Élő pontszám | nincs | van |
| Ranglista | nem befolyásolja | igen |
| Gamification | elrejtve | látható |

**A két mód eredménye soha nem keveredik**, sem a profilban, sem a ranglistán,
sem a normaképzésben.

---

## 10. NAPLÓZÁS — A RENDSZER LEGFONTOSABB TECHNIKAI DÖNTÉSE

Nem csak a végső pontszám kerül adatbázisba. Minden fontos esemény tárolódik,
ezredmásodperc pontossággal, a futás kezdetéhez viszonyítva:

```
 8243.1  stimulus_onset      {block:"simple", quantisationMs:11.1}
 8681.4  response            {outcome:"hit", rtMs:438.3, source:"right"}
 8681.5  trial_end
```

Ez teszi lehetővé, hogy egy ma gyűjtött futásból évek múlva kiszámoljunk egy olyan
metrikát, amire ma nem gondoltunk. Ami nem kerül a naplóba, azt később semmilyen
elemzés nem tudja visszaszerezni.

**Mozgásnaplózás** modulonként konfigurálható: REACT 30 Hz (a mozdulatindítás valós
metrika), MEMORY 5 Hz (semmi nem függ a kéz helyétől), STEADY 60 Hz+ (maga a
lengés a mérés).

**Hálózati hibatűrés.** A kliens minden futást először helyben tárol, és sorba
állít. Egy megszakadt wifi nem semmisíthet meg egy tizenöt perces mérést; a sor
a következő sikeres kapcsolatnál automatikusan ürül.

---

## 11. SCORING ARCHITEKTÚRA

**Három szint.**

1. **Nyers metrika** — `reaction_time = 438 ms`, `correct = true`.
2. **Származtatott metrika** — medián reakcióidő, hit rate, vigilance decrement,
   dual-task cost, post-error recovery, tracking RMS error.
3. **Score (0–100)** — normalizált érték, dokumentált horgonyokkal.

**OPS SCORE (0–1000).** Egyetlen, könnyen kommunikálható szám. A REACT-nál például:

| Összetevő | Súly |
|---|---|
| Sebesség (egyszerű + választásos RT) | 0,26 |
| Pontosság | 0,24 |
| Stabilitás (RT-szórás + lapszusok) | 0,18 |
| Precizitás (célra mutatás hibája) | 0,12 |
| Követés (célon töltött idő) | 0,14 |
| Kétkezes koordináció | 0,06 |

**A pontszám és az assessment eredmény nem ugyanaz.** A 850-es OPS SCORE
kommunikációs mutató. Az assessment megtartja a reakcióidő-eloszlást, az
omission rate-et, a false alarmokat, a munkamemória-kapacitást — mindent, ami
szakmailag értelmezhető.

**Normalizálási horgonyok.** A jelenlegi horgonyok a szakirodalmi PVT- és
választásos RT-tartományokból származnak, korrigálva azzal, hogy a VR-lánc
kb. 40–70 ms többletlatenciát ad egy fizikai gombhoz képest. **Ezek provizórikus
értékek**, amíg a platformnak nincs saját normamintája. A `scoring_version`
minden score mellett tárolódik, így a régi futások később újraszámolhatók
(a `metric_norms` tábla ehhez már létezik).

---

## 12. PSZICHOMETRIAI ÓVATOSSÁG — NEM TÁRGYALHATÓ SZABÁLYOK

Az első verzió **assessment prototípus / demonstrátor**. Nem kezelhető validált
kiválasztási tesztként. A következő szinthez konstruktum-definíció, standardizált
protokoll, megfelelő minta, test–retest reliabilitás, konvergens és kritérium-
validitás, valamint normacsoport szükséges — pszichológus, human factors szakértő
és területi szakértő bevonásával.

**Ne mérjünk többet, mint amit valóban mérünk.**

| Rossz | Jó |
|---|---|
| „A jelölt stressztűrése 62.” | „Performance under time pressure: 62.” |
| „Leadership capability: 88.” | „Observed leadership behaviour in COMMAND task: 88.” |
| „Ez a gyerek kosárlabdázó alkat.” | „A percepciós-kognitív profil a csapatsport-jellegű terhelésekhez illeszkedik.” |
| „Alkalmas a munkakörre.” | „A mért reakcióstabilitás a referenciatartományon belül / kívül esik.” |

**Terület-specifikus figyelmeztetések.**

- **A (védelmi):** kiválasztási döntés önmagában nem alapozható rá.
- **B (munka):** nem foglalkozás-egészségügyi szakvélemény. Munkaviszonyt érintő
  döntéshez a helyi jogszabályok szerinti eljárás kell.
- **C (sport):** fiatalkorúaknál külön adatkezelési és szülői hozzájárulási szabály él.
  A sportágajánlás **irány, nem ítélet**, és nem helyettesíti az edzői és orvosi
  véleményt. A tehetségazonosításban különösen erős a kísértés a korai szelekcióra —
  a rendszer ezért fejlődési profilt ad, nem rangsort.

---

## 13. ADATMODELL

Fő entitások (részletes DDL: `packages/server/src/migrations/001_init.sql`):

```
subjects              pszeudonim azonosító, területek, nincs név
sessions              egy alkalom; terület, eszközprofil
modules               katalógus, verzió, manifeszt
module_domain_relevance   modul × terület → primary/secondary/none
module_versions       verziózott konfigurációk
runs                  egy modul egy futása; seed, mód, eszköz, comparability, OPS
trials                próbánkénti inger + válasz + kimenet
events                teljes eseménynapló, ezredmásodperc felbontással
motion_traces         fej- és kontrollerpálya, futásonként egy dokumentum
metrics               nyers és származtatott metrikák
scores                normalizált pontszámok, scoring_version-nel
teams / team_rounds / team_messages    COMMAND: csapatszintű eredmény és teljes átirat
metric_norms          empirikus normák (a séma kész, a feltöltés későbbi)
audit_log             ki mit nézett meg
```

**Változatok az adatmodellben.** A `runs.variant` és a `teams.variant` oszlop
(`003_variants.sql`, `004_team_variants.sql`) tartja külön az A és B
változatot. A `personal_bests` nézet `config_version` szerint csoportosít,
tehát egy A és egy B futás **soha nem esik egy rekordba**. A COMMAND-B
körkimenete önálló oszlopokba kerül (`inventory_error`, `over_count`,
`under_count`, `best_single_seat_error`, `submitted_inventory`,
`true_inventory`), és a `team_pooling` nézet ebből számolja a `pooling_gain`-t.

**Fair leaderboard.** Két futás csak akkor hasonlítható össze, ha megegyezik a
modul, a modulverzió, **a változat (`config_version`)**, a terület, a mód és a
`comparability` kulcs (`vr:quest3:controller` / `flat:mouse` / `flat:touch`).
Enélkül a ranglista nem embereket rangsorolna, hanem hardvert — vagy azt, ki
választotta a könnyebb változatot.

---

## 14. ADATVÉDELEM ÉS ÜZEMELTETÉS

- **Pszeudonimitás alapból.** A rendszer nem kér és nem tárol nevet. Külső
  azonosító + belső UUID.
- **Belépés nélküli használat.** Bárki kipróbálhat bármely aktív modult belépés
  nélkül; az eredmény ilyenkor nem kerül profilhoz, és ezt a felület kimondja.
  A névtelen futás (kapcsolat nélküli azonosítóval) megőrizhető normaképzéshez —
  ez konfigurálható (`STORE_ANONYMOUS_RUNS`).
- **Szerepalapú hozzáférés, audit log, konfigurálható adatmegőrzés** — az
  architektúrában helyük van az első verziótól.
- **Telepítés.** Docker image, egy konténer szolgálja ki a klienst és az API-t.
  Cél-környezet: **Coolify által kezelt PostgreSQL, Hetzner szerveren.** A TLS
  terminálás a reverse proxy feladata, ami egyben a WebXR biztonságos kontextus
  követelményét is megoldja.

---

## 15. FEJLESZTÉSI SORREND

**Kész (v0.3).**
- Platform core: engine, input absztrakció, 3D UI, trial-állapotgép, naplózás, scoring
- Területválasztás + kezdőtér (2D és VR)
- **01 SIGNAL** teljes — keresési meredekség, MOT, változásészlelés, periféria
- **03 NAV** teljes — útvonal- és felmérési tudás, útvonal-integráció, térkép
- **04 REACT** teljes
- **06 WATCH** teljes — 360°-os emitterrács, térbeli lefedettség és szűkülés
- **07 PRESSURE** teljes — interferencia, váltás, nyomás, helyreállás
- **08 HOLD** teljes — közeledő testek, stop-jel SSRT, pályaítélet
- **09 MEMORY** teljes — 3D Corsi térfogatban, térbeli frissítés
- **10 COMMAND** teljes, AI csapattársakkal
- **11 ANTICIPATE** teljes — koincidencia-időzítés takarással
- **02 SPACE** külső modulként bekötve
- API + PostgreSQL séma + migrációk + export

**Következő.** A `docs/01-MODULE-SPEC-PROMPT.md` szerint modulonként előbb
részletes specifikáció, csak utána implementáció:

1. **12 FIELD**, **15 ADAPT** — adaptív küszöbkeresés, rejtett rotáció.
2. **05 MULTI** — a korábbi alrendszerek egyidejű futtatása; egyben a platform
   stressztesztje.
3. **13 STEADY**, **16 HANDS** — csak VR, 6DoF-alapú mérés.
4. **17 RISK**, **18 PROTOCOL**, **14 RHYTHM**.
5. **19 INTENT** — az ANTICIPATE okklúziós motorjára épül.
6. **AI vizsgálatvezető** (Phase 2).

---

## 16. KAPCSOLÓDÓ DOKUMENTUMOK

| Fájl | Tartalom |
|---|---|
| `docs/01-MODULE-SPEC-PROMPT.md` | Hogyan készül rövid vázlatból teljes modulspecifikáció |
| `docs/02-CROSSPLATFORM-INTERACTION.md` | VR → asztali → mobil leképezés, kötelező referencia |
| `docs/03-SPATIAL-DESIGN.md` | A térbeliség doktrínája: laposítási teszt, hat affordancia, A/B szabályok |
| `docs/10-HUB-SPEC.md` | A kezdőtér részletes specifikációja |
| `docs/11-MODULE-04-REACT.md` | REACT modul részletes specifikációja **+ B változat** |
| `docs/12-MODULE-10-COMMAND.md` | COMMAND modul részletes specifikációja **+ B változat** |
| `docs/13-MODULE-01-SIGNAL.md` | SIGNAL modul részletes specifikációja **+ B változat** |
| `docs/14-MODULE-03-NAV.md` | NAV modul részletes specifikációja |
| `docs/15-MODULE-07-PRESSURE.md` | PRESSURE modul részletes specifikációja **+ B változat** |
| `docs/16-MODULE-11-ANTICIPATE.md` | ANTICIPATE modul részletes specifikációja **+ B változat** |
| `docs/17-MODULE-06-WATCH.md` | WATCH modul részletes specifikációja |
| `docs/18-MODULE-08-HOLD.md` | HOLD modul részletes specifikációja |
| `docs/19-MODULE-09-MEMORY.md` | MEMORY modul részletes specifikációja |
| `docs/20-MODULE-12-FIELD.md` | FIELD modul részletes specifikációja |
| `docs/21-MODULE-13-STEADY.md` | STEADY modul részletes specifikációja |
| `docs/22-MODULE-14-RHYTHM.md` | RHYTHM modul részletes specifikációja |
| `docs/23-MODULE-15-ADAPT.md` | ADAPT modul részletes specifikációja |
| `docs/24-MODULE-05-MULTI.md` | MULTI modul részletes specifikációja |
| `README.md` | Futtatás, fejlesztés, telepítés |
