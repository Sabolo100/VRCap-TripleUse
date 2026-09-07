# VR CAP — projektleírás és nyelvi brief a szöveglektorhoz

Ez a dokumentum a `ui-szovegek.xlsx` táblázat mellé készült. Aki a szövegeket
javítja, ebből tudja meg, **mi ez a rendszer, ki olvassa a szövegeket, milyen
helyzetben olvassa őket, és milyen szakmai nyelvhez kell nyúlnia.**

Kérlek, olvasd végig, mielőtt az első sort átírod. A 4., a 6. és a 12. fejezet
tartalmaz olyan szabályokat, amelyek megsértése **elrontja magát a mérést**,
nem csak a szöveget.

---

## 1. Mi ez a projekt

A **VR CAP** egy WebXR alapú **kognitív, figyelmi, döntési és pszichomotoros
mérőrendszer**. A résztvevő absztrakt térbeli környezetben old meg feladatokat
— gömbök, kockák, gyűrűk, fénypontok —, a rendszer pedig ezredmásodperces
pontossággal rögzíti, mit és mikor csinált.

Néhány tény, ami a nyelvezetet is meghatározza:

- **19 modul**, mindegyik egy-egy képességterületet mér (keresés, éberség,
  munkamemória, gátlás, időzítés, kézügyesség, döntés bizonytalanságban…).
  Minden modul több **részből** áll, egy rész több **próbából**.
- **Három eszközön fut ugyanaz a rendszer:** VR headset (Meta Quest 3, két
  kontrollerrel), asztali böngésző (egér + billentyűzet), és mobil böngésző
  (érintés). **A vezérlés eszközönként más** — ez a lektorálás legfontosabb
  szempontja, lásd az 5. fejezetet.
- **Nem játék és nem kiképzési szimulátor.** A cél a lehető legtisztább,
  zajmentes mérés. Ezért az ingerek szándékosan absztraktak, és a szövegek
  szándékosan tárgyilagosak.
- **Nem validált pszichometriai eszköz**, hanem prototípus. Ez a
  megfogalmazásra nézve kötelező következményekkel jár, lásd a 6. fejezetet.
- A rendszer **felügyelet nélkül** is használható: nincs mellette
  vizsgálatvezető, aki elmagyarázza a feladatot. **Amit a szöveg nem mond el,
  azt a résztvevő nem fogja tudni.**

---

## 2. Kinek szól — három terület, egy motor

Ugyanaz a mérőrendszer három arculattal fut. A területet a felhasználó a
belépéskor választja ki, és ez megváltoztat néhány visszatérő szót:

| | **A — Védelmi** | **B — Munka** | **C — Sport** |
|---|---|---|---|
| Kit mérünk | `operátor` | `vizsgált személy` | `sportoló` |
| Egy lefutás neve | `futás` / `futások` | `mérés` / `mérések` | `gyakorlat` / `gyakorlatok` |
| Egy modul neve | `modul` / `modulok` | `vizsgálat` / `vizsgálatok` | `teszt` / `tesztek` |
| Indítógomb | `MISSZIÓ INDÍTÁSA` | `VIZSGÁLAT INDÍTÁSA` | `TESZT INDÍTÁSA` |
| Pontszám neve | `OPS SCORE` | `PERFORMANCE INDEX` | `PERFORMANCE INDEX` |

**Ezek a szavak területenként rögzítettek.** Ha egy szövegben a „modul" szó
szerepel, nézd meg, melyik területhez tartozik a sor (`MODUL` és `HELY`
oszlop), és ne cseréld át egy másik terület szavára.

> **A legfontosabb következmény:** a **feladatszövegek** (a táblázat
> **1 FELADAT** és **2 FUTÁS KÖZBEN** kategóriája) **területsemlegesek** —
> ugyanaz a szöveg jelenik meg a katonának, az ápolónak és a
> tizenhat éves sportolónak. **Ne vigyél beléjük katonai, egészségügyi vagy
> sportnyelvet.** Ne legyen „misszió", „bevetés", „páciens", „edzés",
> „szerelés". A feladat egy absztrakt feladat, és annak is kell hangoznia.
>
> Területspecifikus nyelv **csak** a **3 KATALÓGUS** kategóriában van, ahol a
> szöveg kifejezetten azt magyarázza, miért releváns az adott terület számára.

---

## 3. Ki olvassa, és mikor

A szövegek négy különböző helyzetben jelennek meg. A táblázat `KATEGÓRIA`
oszlopa ezt jelöli.

| Kategória | Mikor látja | Milyen állapotban van az olvasó |
|---|---|---|
| **1 FELADAT** | A rész indítása **előtt**, egy nagy panelen | Nyugodtan olvas, egyszer. Utána nincs mód visszalapozni. |
| **2 FUTÁS KÖZBEN** | Mérés közben és után | **Fél másodperce van rá.** Perifériásan látja, gyakran mozgás közben. |
| **3 KATALÓGUS** | A modul kiválasztásakor | Böngészik, dönt: elkezdje-e. |
| **4 FELÜLET** | A tesztek körül | Navigál, azonosítót ír be, eredményt néz. |

Ebből következik:

- Az **1 FELADAT** instrukció legyen teljes és önmagában elég. Ez az egyetlen
  hely, ahol hosszan lehet magyarázni.
- A **2 FUTÁS KÖZBEN** szövegek legyenek a lehető legrövidebbek. Egy
  gombfelirat egy szó. Egy státuszsor egy tagmondat.
- A résztvevő headsetben nem tud visszalapozni és nem tud kérdezni.

---

## 4. A szöveg a mérés része — amit nem szabad

Ez a rendszer mérőműszer. **Az instrukció nem kísérőszöveg, hanem mérési
feltétel.** Ha megváltozik, más lesz a mért érték, és a korábbi adatokkal nem
lesz összehasonlítható.

**Tilos:**

1. **Stratégiát javasolni.** Ne írj olyat, hogy „érdemes középre nézni" vagy
   „a leggyorsabb, ha…". A rendszer azt méri, ki mire jön rá magától.
2. **Elárulni egy rejtett manipulációt.** Lásd a 12. fejezet listáját.
3. **Visszajelzést ígérni, ahol nincs.** Mérés közben szándékosan nincs
   visszajelzés és nincs élő pontszám. Ne írd bele, hogy „meglátod, jó volt-e".
4. **Számot megváltoztatni.** Ha a szöveg azt írja, „a próbák felében nincs
   cél", akkor tényleg a felében nincs. Ha „nyolc másodperc várakozás", akkor
   nyolc. Ezek a kód paraméterei — ne kerekítsd, ne „pontosítsd".
5. **Elhagyni egy feltételt.** Ha a szöveg kimondja, hogy „ne fordítsd oda a
   fejed" vagy „ne javítgasd útközben", az a mérés érvényességének feltétele.
6. **Kihagyni a vezérlő megnevezését.** Minden instrukcióban szerepelnie kell,
   **mivel** kell válaszolni azon az eszközön.

**Ha egy szöveg feltűnően szűkszavú, először nézd meg a 12. fejezetet** —
valószínűleg szándékos.

---

## 5. Eszközfüggő szókincs — a lektorálás magja

Ha a táblázat `PLATFORM` oszlopában `VR`, `asztali` vagy `mobil` szerepel, a
szöveg **csak azon az eszközön** jelenik meg, és **csak az ott létező
vezérlőt** szabad megneveznie. Ha `mind` szerepel, a szöveg minden eszközön
ugyanaz — ilyenkor **nem szabad benne konkrét gombot említeni**.

| Művelet | **VR** | **Asztali** | **Mobil** |
|---|---|---|---|
| Egyszerű válasz | „húzd meg a ravaszt" | „nyomd meg a SZÓKÖZT (vagy kattints)" | „nyomd meg a képernyő alján a **NÉV** gombot" |
| Bal / jobb válasz | „a BAL ravasz" / „a JOBB ravasz" | „az F billentyű (vagy a balra nyíl)" / „a J billentyű (vagy a jobbra nyíl)" | „a BAL gomb" / „a JOBB gomb" |
| Második, elkülönülő gomb | „a MARKOLATGOMB (grip)" | „jobb kattintás" | külön nevesített gomb |
| Kijelölés a térben | „mutass rá a kontroller sugarával, és húzd meg a ravaszt" | „kattints rá" | „koppints rá" |
| Célon tartás | „tartsd rajta a kontroller sugarát" | „kövesd az egérkurzorral" | „tartsd rajta az ujjad" |
| Körülnézés | „fordulj meg" (fejmozgás) | „nézz körül az egér húzásával" | „nézz körül az ujjad húzásával" |
| Folyamatos analóg vezérlés | „a bal kar" (thumbstick) | „a WASD vagy a nyíl billentyűk" | „a bal alsó sarokban lévő kar" |
| Nyúlás, megfogás | „nyúlj oda a kontrollerrel", „a ravaszt lenyomva tartva" | *nem létezik* | *nem létezik* |
| Kilépés méréssel | „a bal kontroller MENÜ gombja" | — | vissza-gesztus |

**Szóhasználati pontosítások:**

- VR-ben a mutatóujjas gomb neve **ravasz**, nem „trigger". A középső ujjas
  gomb neve **markolatgomb**, első előforduláskor zárójelben `(grip)`, mert a
  headseten így hívják a felhasználók.
- A kontroller által kilőtt egyenes neve **a kontroller sugara**, nem
  „lézer", nem „pointer".
- Asztalon **SZÓKÖZ** (nagybetűvel), **F billentyű**, **J billentyű**,
  **balra nyíl**, **jobbra nyíl**, **bal kattintás**, **jobb kattintás**,
  **egérkurzor**. Nem „space", nem „klikk".
- Mobilon a válasz **majdnem mindig nevesített gomb**, nem puszta koppintás.
  Ha a szöveg azt írja, „koppints", akkor a jelenetben lévő tárgyra kell
  koppintani; ha gombot ír, akkor a képernyő alján lévő sávra. **A kettőt ne
  keverd össze** — a táblázatban ott van, melyikről van szó.
- A telefon képernyőjének alsó sávja: **„a képernyő alján"**. Ne „az alsó
  menüben", ne „a toolbaron".

---

## 6. Pszichometriai megfogalmazás — nem tárgyalható

A rendszer **megfigyelt teljesítményt** mér egy **konkrét feladatban**. Soha
nem mond ki képességet, alkalmasságot, jellemvonást vagy diagnózist.

| ❌ Így nem | ✅ Így igen |
|---|---|
| „A stressztűrésed 62." | „Teljesítmény időnyomás alatt: 62." |
| „Vezetői képesség: 88." | „Megfigyelt vezetői viselkedés a COMMAND feladatban: 88." |
| „Alkalmas vagy a munkakörre." | „A mért reakcióstabilitás a referenciatartományon belül van." |
| „Kockázatkerülő típus vagy." | „Megfigyelt kockázatvállalás ebben a feladatban." |
| „Ez a gyerek kosaras alkat." | „A percepciós-kognitív profil a csapatsport-jellegű terhelésekhez illeszkedik." |

**Kerülendő szavak az eredmény- és katalógusszövegekben:** alkalmas,
alkalmatlan, tehetség, adottság, jellem, típus, személyiség, diagnózis,
IQ, szint (mint minősítés), „jó/rossz ember".

**Használható:** megfigyelt teljesítmény, mért érték, ebben a feladatban,
referenciatartomány, mintázat, profil, eltérés, stabilitás.

Egy dolog **kifejezetten ki van mondva** és nem törölhető: a RISK modulnál a
„nincs helyes megállási pont", és az eredményképernyők jogi lábjegyzetei
(„Teljesítménymutató, nem pszichológiai diagnózis…"). Ezeket lehet
szebbé tenni, de a tartalmukat nem gyengíteni.

---

## 7. Rögzített szavak — ezeket ne írd át

### 7.1. Gombfeliratok

A feliratok **ténylegesen ki vannak írva a képernyőre**. Ha egy instrukció
hivatkozik rájuk, a két helyen **szó szerint ugyanannak** kell állnia. Ha
átnevezel egy gombot, minden rá hivatkozó instrukciót is át kell nevezni —
ilyenkor írd a `MEGJEGYZÉS` oszlopba, hogy összetartozó változtatás.

```
BAL · JOBB · MOST · KÉSZ · NINCS CÉL · ELTÉRÉS · UGYANOTT · VILLANÁS
ERRE VAN · PUMPA · BEVÁLTÁS · KOCKA · GÖMB · FELÉM · TŐLEM EL
TIPP · TALÁN · BIZTOS · JELÖLÉS · MEHET · KÉSZ VAGYOK · FOLYTATOM
KIHAGYOM · KÖVETÉS · INDULHAT · KILÉPÉS · VISSZA · GYAKORLÁS
KIPRÓBÁLOM · KEZDHETJÜK · INDÍTÁS · ÚJ SZOBA · CSATLAKOZÁS
A SAJÁT NÉZETEM · SZOBA LÉTREHOZÁSA · VISSZA A KÖZPONTBA · ÍRÁS
```

Az eredményképernyő sorcímei (`Belső óra`, `Testlengés`, `Romberg-hányados`,
`Kéztremor`, `Előretartás`…) **nem gombok**, hanem mérőszámok magyar nevei.
Ezek szakkifejezések: ha pontatlannak érzed valamelyiket, javítsd — de a
`Romberg-hányados` és a `Kéztremor` bevett szakszó, maradjon.

### 7.2. Színek és alakzatok

Ezek **leírják, mi látszik a képernyőn**. A „CIÁN" tényleg cián, nem
„világoskék". A „gömb" tényleg gömb, nem „golyó" vagy „labda".

- **Színek:** PIROS, KÉK, CIÁN, MAGENTA, NARANCSSÁRGA, FEHÉR, ZÖLD, szürke
- **Alakzatok:** gömb, kocka, gyűrű, korong, henger, pálcika, nyíl, pont,
  fénypont, tömb (több objektum együtt)

A rendszer stílusa, hogy a **döntést hordozó kulcsszót nagybetűvel** emeli ki:
„a cél a **NARANCSSÁRGA KOCKA**", „amelyik **PIROS ÉS PULZÁL**". Ez
szándékos, tartsd meg — de ne szaporítsd: mondatonként legfeljebb egy-két
ilyen kiemelés.

---

## 8. Terminológiai szótár

| Fogalom | Így nevezzük | Így **nem** |
|---|---|---|
| A 19 mérés egyike | modul / vizsgálat / teszt (területtől függ) | „gyakorlat", „szint", „pálya" |
| Egy modul szakasza | **rész** (a felületen), blokk (belső név) | „fejezet", „kör" (kivéve COMMAND) |
| Egy mérési esemény | **próba** | „kísérlet", „forduló" |
| Egy folyamatos szakasz | **menet** (PROTOCOL, HANDS, COMMAND) | „kör", „játék" |
| Amit mutatunk | **inger** (szakszóként), egyébként a tárgy neve | „stimulus" |
| Amit meg kell találni | **cél** | „target" |
| A zavaró elemek | **zavaró elem**, „a többi objektum" | „disztraktor" (a felhasználó felé) |
| Az összehasonlítási szakasz | **alapvonal** | „baseline" |
| Tanulószakasz visszajelzéssel | **gyakorlás** | „tutorial", „bemelegítés" |
| Az elrejtés | **takarás** | „okklúzió" (a felhasználó felé) |
| Testmozgás állás közben | **lengés** | „ingadozás", „sway" |
| Rádiós azonosító (MULTI) | **hívójel** | „call sign" |
| Az ismétlődő minta | **ütem** (RHYTHM) | „beat", „ritmus" |
| Kézre vonatkozó pontosság | **finommotoros pontosság** | „finommotorika" önmagában |

**Idegen szó akkor maradhat**, ha nincs pontos magyar megfelelője, és
zárójelben magyarázzuk: `markolatgomb (grip)`, `pontfény-alak (point-light)`.
A metrikanevek (`dual_task_cost`, `resumption_lag`) **nem jelennek meg a
felületen**, tehát nem is szerepelnek a táblázatban — ha mégis látsz ilyet,
hagyd angolul.

---

## 9. Hangnem

- **Tegezés, mindig.** Egységesen, minden területen, minden korosztálynak.
- **Nyugodt, tárgyilagos, felnőtthöz szóló.** A résztvevő lehet katona,
  ápoló vagy tizenhat éves sportoló — mindegyikük felnőttként legyen
  megszólítva.
- **Nincs lelkesedés, nincs gamifikáció.** Nincs felkiáltójel, nincs
  „Szuper!", „Hajrá!", „Ügyes vagy!". A visszajelzés tényszerű: „Helyes",
  „Nem — balra ment".
- **A nehézséget kimondjuk, és megengedők vagyunk vele.** Ez a rendszer
  hangja: *„Ez nehéz — nem baj, ha nem tökéletes."*, *„A szórás a normális."*,
  *„Ha egyszer sem sikerül megállnod, az azt jelenti, hogy túl korán
  kötelezed el magad."*
- **Nem ijesztünk.** A nyomás alatti részeknél kimondjuk: *„Nincs benne semmi
  ijesztő; csak kevesebb az idő."*
- **Egyes szám első személy a rendszer részéről** ott, ahol már így van:
  *„addig gyorsítom, amíg meg nem találom a határodat"*, *„egyszer mondom
  el"*. Ez tudatos: a mérés vezetője beszél. Ne írd át személytelenre.

---

## 10. Formai szabályok

- **Tizedesvessző:** `2,8°`, `0,72` — nem pont.
- **Mértékegység:** szóközzel, kivéve a fokjelet: `5 s`, `30 mm`, `120 ms`,
  de `42°`. Százalék szóköz nélkül: `40%`.
- **Ezres tagolás:** keskeny szóközzel vagy sehogy: `1250` marad.
- **Gondolatjel:** nagykötőjel szóközökkel — `szöveg — szöveg`. Nem `-`.
- **Idézőjel:** magyar `„…"`.
- **Hármaspont:** `…` egy karakterként.
- **Sorköz és tördelés:** a táblázatban egy cella egy szöveg; ne tegyél bele
  sortörést.
- **Hosszú ő és ű:** ellenőrizd (`gyűrű`, `időnyomás`, `felvillan`).
- **Toldalékolás magánhangzó-harmónia szerint:** `modulok`, de `tesztek`,
  `mérések`. A rendszer ezt már külön kezeli — ha ilyet látsz, ne „javítsd"
  egységesre.

---

## 11. Hosszkorlátok

A szövegek fix méretű panelekre kerülnek. A jelenlegi értékek mérve:

| Mező | Jelenlegi átlag | Jelenlegi max | **Amit tarts** |
|---|---|---|---|
| instrukció | 239 | 522 | max **500** karakter; ideális 200–350 |
| IRÁNYÍTÁS sor | 66 | 122 | max **110** karakter, két sor |
| mobil súgósor | 46 | 109 | max **100** karakter, egy sor |
| blokk címe | 11 | 28 | max **24** karakter, nagybetűs |
| gombfelirat | 8 | 19 | mobilon max **12**, panelen max **18** |
| gomb alsó sor | 22 | 36 | max **36** karakter |
| eredménysor címe | 17 | 32 | max **28** karakter |
| eredménysor magyarázata | 31 | 88 | max **70** karakter |
| katalógus összefoglaló | 138 | 158 | max **160** karakter |
| katalógus indoklás | 109 | 169 | max **180** karakter |

Az instrukciós panel automatikusan kisebb betűre vált, ha kell — de 500
karakter fölött már nehezen olvasható. **Ha egy instrukció most rövid, ne
hízlald fel**: a rövidség gyakran szándékos (12. fejezet).

---

## 12. Amit szándékosan NEM mondunk el

Ezek a szövegek azért szűkszavúak vagy hiányosak, mert a mérés ezt kívánja.
**Ne egészítsd ki őket.**

| Modul | Rész | Amit nem szabad elárulni |
|---|---|---|
| **15 ADAPT** | `FOLYTASD`, `TOVÁBB`, `MÉG EGYSZER` | Hogy közben egy **rejtett 30°-os forgatás** kapcsol be. A szöveg szó szerint annyi: „Folytasd ugyanígy." Ha bővíted, a modul nem tanulást mér, hanem stratégiát. |
| **17 RISK** | mindegyik | A robbanási pontot, az optimális megállást, a paklik szerkezetét. Azt viszont **ki kell mondani**, hogy nincs helyes megállási pont. |
| **19 INTENT** | `MERRE INDUL` | A megtévesztés **tényét elmondjuk**, az **arányát nem**. |
| **08 HOLD** | `SZABÁLYVÁLTÁS` | A szabályfordulás **tényét elmondjuk**, az **időpontját nem**. |
| **07 PRESSURE** | `NYOMÁS` | Ugyanez. |
| **18 PROTOCOL** | `NYOMÁS ÉS VÁLTOZÁS` | A változást **egyszer** mondjuk el, a mérés előtt. Ne ismételtesd meg. |
| **06 WATCH** | `SZOLGÁLAT A/B` | Hogy nincs visszajelzés — ezt **ki kell mondani**, mert különben a résztvevő azt hiszi, elromlott. |
| **12 FIELD** | `MOZGÓ CÉL` | Az adaptív gyorsítás tényét **elmondjuk** („addig gyorsítom, amíg…"). |
| **09 MEMORY** | `ELFORDULT TÉR` | A forgatás tényét **elmondjuk** — itt, ADAPT-tal ellentétben, ez szándékos. |
| **01 SIGNAL** | keresési részek | A céltalan próbák arányát **elmondjuk** („a próbák felében"). |

---

## 13. Kategóriánkénti eligazítás

**1 FELADAT** — a legfontosabb. Minden instrukcióban legyen meg ez a három:

1. **Mi fog történni / mi jelenik meg.**
2. **Mit kell tenned, és mivel** — az adott eszköz vezérlőjével megnevezve.
3. **Mi számít** — pontosság vagy sebesség, mit ne csinálj, mi a mérés lényege.

Ha valamelyik hiányzik, pótold. Ha valamelyik zavaros, írd újra — ez a
lektorálás fő haszna.

**2 FUTÁS KÖZBEN** — rövidség. Egy gombfelirat egy szó. Egy státuszsor egy
tagmondat. A visszajelzés tényszerű, nem értékelő.

**3 KATALÓGUS** — itt lehet szakmai nyelvet használni, területenként.
A `fejléc` egy fél mondat, az `indoklás` 1–2 mondat arról, **miért releváns
ez a mérés az adott területen**. Itt a 6. fejezet szabályai a legszigorúbbak.

**4 FELÜLET** — navigáció és jogi szöveg. Legyen egyszerű és pontos.
A jogi lábjegyzetek tartalmát ne gyengítsd.

---

## 14. Jó és rossz példák

**Instrukció, asztali gép:**

> ❌ „A gömb két szín egyikében villan fel. PIROS esetén a bal, KÉK esetén a
> jobb oldali válasz kell."
> *Baj: laptopon nincs „bal oldali válasz". Nem tudni, mit kell megnyomni.*

> ✅ „A gömb PIROS vagy KÉK színben villan fel. Ha PIROS, nyomd meg az F
> billentyűt (vagy a balra nyilat); ha KÉK, a J billentyűt (vagy a jobbra
> nyilat). Tartsd a két mutatóujjad az F-en és a J-n. A jó válasz fontosabb,
> mint a gyors — de mindkettőt mérjük."

**Instrukció, hiányos cél:**

> ❌ „Négy állomás egyszerre. Kiemelt mutató a dual-task cost."
> *Baj: nem derül ki, mi a négy állomás, sem hogy mit kell csinálni.*

> ✅ Állomásonként egy tagmondat, mindegyikben a vezérlővel — lásd a MULTI
> jelenlegi szövegét a táblázatban.

**Visszajelzés:**

> ❌ „Szuper, eltaláltad! 🎯"  ✅ „Helyes"
> ❌ „Sajnos elrontottad."     ✅ „Nem — balra ment"

**Eredménysor:**

> ❌ „Stressztűrés: 62"  ✅ „Teljesítmény időnyomás alatt: 62"

---

## 15. Hogyan dolgozz a táblázattal

1. Szűrj a `KATEGÓRIA` oszlopban, és haladj **1 → 2 → 3 → 4** sorrendben.
2. A `PLATFORM` oszlopot mindig nézd meg. Ha `VR` / `asztali` / `mobil`, az 5.
   fejezet szerinti vezérlőt kell tartalmaznia.
3. Ahol javítasz, írd a teljes új szöveget a **`JAVÍTOTT SZÖVEG`** oszlopba.
   Amit üresen hagysz, változatlan marad.
4. Ha valami **nem nyelvi** probléma (rossz a gomb helye, hiányzik egy
   lépés, két szöveg ellentmond egymásnak), írd a **`MEGJEGYZÉS`** oszlopba.
5. **Ne írd át az `ID` oszlopot.** Ez alapján kerül vissza a szöveg a kódba.
6. Ha egy `mind` platformú sorhoz eszközfüggő szöveget írnál, jelezd a
   megjegyzésben — a sort utólag háromra bontjuk.
7. Ha egy gombfeliratot átnevezel, jelezd, mert a rá hivatkozó instrukciókat
   is módosítani kell.

Köszönöm — a legtöbb értéket az **1 FELADAT** kategória alapos átnézése adja.
