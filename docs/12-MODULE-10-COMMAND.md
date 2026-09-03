# 12 — MODUL 10: COMMAND
## Csapat, problémamegoldás & vezetés — részletes specifikáció

**Verzió:** 1.0.0 · **Állapot:** implementálva
**Kód:** kliens `packages/client/src/modules/command/` · szerver `packages/server/src/realtime/CommandRoom.ts`
**Résztvevők:** 2–5 fő (AI csapattársakkal 1 élő fő is elég)
**Névleges időtartam:** ~13 perc (45 s brief + 2 × 5 perc kör + 30 s szünet)
**Doménkötés:** A elsődleges · B elsődleges · C másodlagos

---

## 1. CÉL ÉS KONSTRUKTUM

**Egy mondatban:** a COMMAND azt méri, hogy egy csoport képes-e összerakni azt a
tudást, amit egyenként birtokolnak, és ki az, akinek a hozzájárulására a csoport
ténylegesen épít.

### A központi tervezési döntés: rejtett profil

A résztvevők **közös táblát** látnak, de a táblán szereplő adatok egy része hibás,
és a javításokat **egyenként, külön-külön** ismerik. Az optimális terv csak akkor
érhető el, ha megosztják, amit tudnak.

Ez azért fontos, mert így az információmegosztás **nem az átiratból becsült
puha mutató, hanem közvetlenül látszik az eredményen**. Egy csapat, amely nem
beszél, mérhetően rosszabb tervet ad be — a generátor garantálja, hogy a
tisztán a nyomtatott tábla alapján készített legjobb terv is legfeljebb 75%-át
éri el az elérhetőnek (mérve: átlagosan 36%).

### Mért konstruktumok

| Konstruktum | Katalógus # |
|---|---|
| Csapatkommunikáció | 81 |
| Együttműködő problémamegoldás | 82 |
| Vezetői viselkedés | 83 |
| Delegálás | 84 |
| Erőforrás-elosztás | 85 |
| Prioritáskezelés | 43 |
| Konfliktuskezelés | 86 |
| Vezető nélküli csoportfeladat | 78 |
| Command task | 79 |

### Amit a modul NEM mér

- **Nem méri a vezetői képességet.** Megfigyelt vezetői *viselkedést* mér egy
  konkrét feladatban. A megfogalmazás kötelezően: „Observed leadership behaviour
  in COMMAND task”.
- **Nem méri, ki beszél a legtöbbet.** A beszédmennyiség önmagában nem pontoz —
  ez szándékos, mert a jutalmazása pontosan a rossz viselkedést tanítaná meg.
- **Nem taktikai szimuláció.** A tábla absztrakt; nincs terep, nincs ellenség,
  nincs domén-specifikus szakértelem, amit tudni kellene.

---

## 2. A FELADAT: „GRID”

### 2.1. A tábla

Hat helyszín (`S1`–`S6`, betűjelekkel: ALFA … FOXTROT) egy asztalon, kissé
szabálytalan gyűrűben. Köztük útvonalak: a gyűrű mentén hat, plusz három átló.
Minden útvonalnak van közzétett költsége (2–7).

**Négy egység** (`U1`–`U4`) áll a helyszíneken. Mindegyiknek van közzétett
készlettípusa (ALFA / BRAVO / CHARLIE) és kapacitása (2–5).

**Négy feladat** (`T1`–`T4`) helyszínekhez kötve. Mindegyiknek van közzétett
igényelt készlettípusa, értéke (20–60 pont), igénye (1–4) és határideje (6–12
költségegység).

### 2.2. A terv

A csapat egységeket rendel feladatokhoz. Egy feladat teljesül, ha:
- az egység készlettípusa **egyezik** az igényelttel,
- a kapacitása **elég**,
- a legrövidebb út költsége **a határidőn belül** van,
- és a feladatot **még nem foglalta el** másik egység.

Az elért érték a teljesített feladatok értékének összege.

### 2.3. A rejtett javítások

Minden résztvevő 2 privát tényt kap. A generátor nyolcféle javítást ismer:

| Típus | Példa |
|---|---|
| `route_closed` | „A FOXTROT–ALFA útvonal LEZÁRVA. A táblán még nyitottként szerepel.” |
| `route_cost` | „A BRAVO–DELTA szakasz valós költsége 9 (nem 4).” |
| `site_hazard` | „ECHO körzetében akadály: minden áthaladás +3 költség.” |
| `unit_resource` | „EGYSÉG 3 valójában BRAVO készletet szállít, nem ALFA-t.” |
| `unit_capacity` | „EGYSÉG 2 kapacitása csak 1 (a tábla 3-at mutat).” |
| `task_value` | „FELADAT 4 valós értéke 80 pont — a táblán alulértékelt.” |
| `task_requires` | „FELADAT 1 valójában CHARLIE készletet igényel.” |
| `task_demand` | „FELADAT 3 tényleges igénye 5 egység.” |

### 2.4. A generátor garanciái

Egy generált tábla csak akkor kerül felhasználásra, ha:
- **megoldható** — a teljes információval elérhető érték ≥ 90 pont, és
- **büntetni tudja a hallgatást** — a csak a nyomtatott tábla alapján készíthető
  legjobb terv az elérhető értéknek legfeljebb 75%-át hozza.

Ha 48 próbálkozáson belül nem születik ilyen, a legjobb közelítést használjuk.
1200 legenerált tábla mérve: **egy sem megoldhatatlan**, az átlagos
„megosztás nélküli” arány **0,336**, a legrosszabb eset **0,750**
(`tests/command-scenario.test.ts`).

A generálás **determinisztikus**: azonos seed azonos táblát ad, tehát egy futás
visszajátszható, és két csapat kaphat pontosan azonos feladatot.

---

## 3. A KÉT KÖR

### A KÖR — VEZETŐ NÉLKÜL (leaderless)

Nincs kijelölt vezető. Bárki mozgathat egységet, bárki oszthat meg tényt.
A terv lezárásához **minden csatlakozott ember készre jelentkezése** kell.
Aki lezárásra szavaz, de a többiek még nem, azt a rendszer kiírja a rádiócsatornára.

Ha bárki megváltoztatja a tervet, **mindenki készre jelentkezése törlődik** —
egy terv nem zárható le úgy, hogy a jóváhagyás óta más lett belőle.

### B KÖR — KIJELÖLT PARANCSNOK (command task)

**A parancsnok kijelölése nem véletlenszerű.** A rendszer az A körben mért
vezetői indexet használja, kis emberi preferenciával a botokkal szemben. Így a
kinevezés a megfigyelt viselkedés következménye, nem önkényes választás.

A parancsnok mozgat egységet és zár le. A többiek **javaslatot** tehetnek
(a kliens automatikusan javaslattá alakítja a mozgatást, és a szerver ezt
kikényszeríti) és információt oszthatnak meg.

**Menet közbeni információfrissítés.** A kör 40%-ánál egy útvonal lezárul.
A frissítés akkor érkezik, amikor már van terv, tehát mérhető, hogy a csapat
mennyire tud átállni — ez az `adaptation_after_update` mutató alapja.

---

## 4. AI CSAPATTÁRSAK

A COMMAND legnagyobb gyakorlati kockázata, hogy demonstrálhatatlan és
tesztelhetetlen: öt embert kell headsetbe ültetni. Ezért a szerver **botokat**
tud a szobába tenni.

A bot nem díszlet. **Valódi privát tényeket kap** ugyanabból a készletből, és:

- **megosztja őket késleltetve**, a saját „nyitottságától” (`openness`) függő
  valószínűséggel,
- **prioritással válaszol kérdésre** — ha valaki kérdőjelet írt a csatornába,
  85% eséllyel azonnal megoszt egy tényt,
- **javaslatot tesz** a saját, hiányos világképe alapján: megoldja az optimalizálást
  arra a táblára, amit ő ismer (saját tényei + a mások által megosztottak),
- **parancsnokként lezár**, ha kevesebb mint 20 s van hátra.

A `botStyle` háromféle: `cooperative` (magas nyitottság), `reticent`
(alacsony — hallgat a tényein), `mixed` (véletlenszerű, ez az alapértelmezés).

A **hallgatag bot szándékos**: egy egyedül tesztelő ember így megtapasztalja azt
a kudarcmódot, amit a feladat ki akar mutatni.

**A botokkal futott munkamenetek meg vannak jelölve** (`isBot`), és a normaképzésben
nem keverhetők a csupa emberi futásokkal.

---

## 5. INTERAKCIÓ

### 5.1. Térbeli elrendezés

A résztvevők az asztal körül állnak, egyenletesen elosztva 1,15 m sugáron,
befelé nézve. A szerver ülőhelyet oszt; a kliens odateszi a rigjét, és a
paneleket az ülőhelyhez horgonyozza.

**Avatarok.** Gömb fej + kapszula test + két kéz, ülőhely szerinti színnel,
felirattal (`A`, `B`, `C` …, botoknál `· AI`). A fej és a kéz valós pózt követ.
Hang bekapcsolásakor a fej körüli glória a beszéd hangerejével világít.

**Póz-szinkronizáció.** A pózok **ülőhely-lokális** koordinátákban utaznak, 12 Hz-en.
Így a fogadónak nem kell közös világorigó: az ülőhely transzformációját alkalmazza,
és a helyére kerül.

### 5.2. Kiosztás

```
egységre mutat → kijelöl (felnagyul, forogni kezd)
célgyűrűre mutat → kiosztja
ugyanarra az egységre újra → kijelölés megszüntetése
asztalra / helyszínre → kijelölés megszüntetése
SECONDARY a táblán → térbeli jelölés (ping), 2,4 s-ig látszik, ülőhelyszínnel
```

A panelek elsőbbséget élveznek: ha egy panel közelebb van a sugár mentén, mint a
tábla, a kattintás a panelé.

### 5.3. Kommunikációs csatornák

| Csatorna | Mérhető? | Megjegyzés |
|---|---|---|
| **Tény megosztása** | igen, egyértelműen | Külön gomb tényenként; ki, mit, mikor |
| **Gyorsüzenetek** | igen | 8 előre definiált mondat |
| **Szabad szöveg** | igen | 3D billentyűzet, max 240 karakter |
| **Térbeli ping** | igen | Pozíció + ülőhely |
| **Hang (WebRTC)** | nem közvetlenül | Opcionális, alapból ki |

**Miért a strukturált csatorna a mérés alapja?** Mert egyértelmű. A „megosztottam
a tényt” gombnyomás nem igényel beszédfelismerést, nem téveszthető el, és
ezredmásodpercre datálható. A hang attól még hasznos — a gyakorlat élővé válik
tőle —, de a metrika a naplóból jön.

**Hang.** Teljes mesh WebRTC (max 5 fő = 10 kapcsolat, SFU nélkül), jelzés a szoba
WebSocketjén, „perfect negotiation” mintával. Opt-in; mikrofon-megtagadás esetén
a szöveges csatorna változatlanul működik.

---

## 6. HÁLÓZATI PROTOKOLL

`GET /ws/command`, JSON keretek, szobára szűkítve. **A szerver az autoritás**
a fázisra, a rejtett tényekre és a pontozásra.

### Kliens → szerver
`create` · `join` · `leave` · `ready` · `start` · `chat` · `shareFact` ·
`assign` · `propose` · `commit` · `ping` · `pose` · `rtc` · `heartbeat`

### Szerver → kliens
`room` (fázis, tagok, idő) · `you` (ülőhely, szerep, **saját** tények) ·
`scenario` (a **nyilvános** tábla) · `chat` · `proposal` · `plan` · `ping` ·
`pose` · `infoUpdate` · `roundResult` · `final` · `rtc` · `error`

**A `you` üzenet csak a saját tényeket tartalmazza.** A többiek tényei csak
akkor kerülnek a csatornára, amikor a tulajdonosuk megosztja őket. Ez teszi a
megosztási metrikát megbízhatóvá.

### Fázisok

```
lobby → briefing (45 s) → roundA (300 s) → interlude (30 s) → roundB (300 s) → debrief
```

### Újracsatlakozás

A szoba a résztvevőt **külső azonosító alapján** ismeri fel, és visszaadja neki
az ülőhelyét, a tényeit és a szerepét. Élő kör közben a hely nem szabadul fel.
A kliens exponenciális visszalépéssel újrapróbálkozik, és a visszatérő
résztvevő megkapja az utolsó 40 üzenetet, a javaslatokat és az aktuális tervet.

Egy ötfős munkamenet elvesztése egy megszakadt wifi miatt elfogadhatatlan lenne.

---

## 7. METRIKÁK

### Csapatszintű

| Metrika | Definíció |
|---|---|
| `plan_optimality` | Elért érték / teljes információval elérhető maximum |
| `information_coverage` | Megosztott tények / összes tény a szobában |
| `time_to_commit_ms` | A kör kezdetétől a lezárásig |
| `revisions` | A terv módosításainak száma |
| `board_only_baseline` | Amit megosztás nélkül el lehetett volna érni |

### Egyéni

| Metrika | Definíció |
|---|---|
| `information_sharing_rate` | Megosztott / birtokolt tények |
| `time_to_first_share_ms` | Az első megosztásig eltelt idő |
| `messages_sent`, `talk_share` | Üzenetszám és részesedés az összes üzenetből |
| `questions_asked` | Kérdést tartalmazó üzenetek |
| `responsiveness` | Kérdésre adott válaszok / összes üzenet |
| `proposals_made` / `proposals_adopted` | Javaslatok és azok elfogadása |
| `adoption_rate` | Elfogadott / tett javaslat |
| `assignments_made` | Saját kezűleg végrehajtott kiosztások |
| `overrides` | Más friss kiosztásának felülírása |
| `ready_latency_ms` | Készre jelentkezésig eltelt idő |
| `adaptation_after_update` | B körben az információfrissítés utáni cselekvések |

### A vezetői index

```
leadership =  0,34 × javaslat-elfogadási arány
            + 0,24 × min(1, kiosztások / 4)
            + 0,16 × min(1, kérdések / 3)
            + 0,16 × információmegosztási arány
            + 0,10 × min(1, kérdésre adott válaszok / 3)
            − 0,08 × min(1, felülírások / 3)
```

Amit ez a képlet **szándékosan nem** tartalmaz: a beszédmennyiséget. A csoportos
kiválasztás legrégebbi hibája, hogy a legtöbbet beszélőt jutalmazza. Itt az számít,
hogy a csapat **épített-e** arra, amit valaki mondott — a javaslat-elfogadás
súlya a legnagyobb —, és hogy az illető **kérdezett-e**, mert a kérdés hozza
elő mások információját. A társak felülírása levon, mert az koordinációs zaj.

### OPS SCORE

| Összetevő | Súly |
|---|---|
| Csapateredmény (`plan_optimality`) | 0,40 |
| Egyéni hozzájárulás | 0,30 |
| Vezetői index | 0,20 |
| Gyorsaság (első megosztásig) | 0,10 |

A csapateredmény 40%-a szándékos: közös feladat, közös felelősséggel. A maradék
60% az, amivel az egyén ténylegesen hozzájárult.

---

## 8. ADATBÁZIS

Három saját tábla a `runs`/`trials`/`events` mellett:

```sql
teams          -- szoba, terület, seed, konfiguráció, nehézségi diagnosztika
team_rounds    -- körönként: terv, elért/optimális érték, idő, lefedettség, revíziók,
               --            és a teljes egyéni pontozás JSONB-ben
team_messages  -- teljes átirat: ülőhely, azonosító, bot?, típus, szöveg, ezredmásodperc
```

A `team_messages` a legértékesebb: a teljes kommunikációs napló utólagos
elemzésre. Minden résztvevő ezen felül saját `runs` sort is beküld, amelyet
a `team_id` köt össze.

---

## 9. FELHASZNÁLÓI FOLYAMAT

1. **INTRO** — a modul leírása, a két kör.
2. **LOBBY** — „ÚJ SZOBA” vagy „CSATLAKOZÁS”.
   - Új szoba: hány AI társ (0–4), majd létrehozás → négybetűs kód.
   - Csatlakozás: kód beírása a 3D billentyűzeten.
   - Résztvevőlista, készre jelentkezés, a házigazda indít.
3. **BRIEFING** (45 s) — a tábla megjelenik, a privát tények olvashatók, a terv
   még nem szerkeszthető.
4. **A KÖR** (5 perc) — háromsávos felület:
   - **BRIEF** fül: a privát tények, mindegyik alatt „MEGOSZTOM A CSAPATTAL”.
   - **RÁDIÓ** fül: üzenetnapló, 6 gyorsüzenet, írás, hang.
   - **CSAPAT** fül: résztvevők, szerepek, kapcsolat, javaslatok.
   Középen a terv-panel: egységenkénti kiosztás, visszaszámláló, lezárás.
5. **INTERLUDE** (30 s) — az 1. kör eredménye, benne az, hogy mennyi lett volna
   megosztás nélkül.
6. **B KÖR** (5 perc) — parancsnokkal, menet közbeni információfrissítéssel.
7. **DEBRIEF** — a két kör összevetése, csapatpontszám, egyéni mutatók.

---

## 10. VALIDÁCIÓ ÉS KORLÁTOK

**Származás.** A brit tisztjelölt-kiválasztás bevált formátumának absztrakt
változata: vezető nélküli csoportvita + tervezési feladat + parancsnoki feladat.
A rejtett javítások a hidden profile paradigmából származnak.

**Amit tudunk.** A generátor garantálja, hogy a megosztás mérhetően kifizetődő.
A pontozás determinisztikus és visszaszámolható. Az átirat teljes.

**Amit nem tudunk.** Nincs adatunk arról, hogy az itt mért vezetői index
előrejelzi-e a valós vezetői teljesítményt. Ehhez kritérium-validitási vizsgálat
kell, valós vezetői értékelésekkel összevetve. **Addig az eredmény megfigyelt
viselkedés, nem képességbecslés.**

**Csoportméret-hatás.** Két fővel a dinamika minőségileg más, mint öttel:
a vezetői emergencia gyakorlatilag nem értelmezhető két résztvevőnél. Négy-öt fő
az érdemi tartomány; a létszám minden futással tárolódik.

**Nyelv és kultúra.** A szabad szöveges csatorna magyar nyelvű elemzést feltételez
(a kérdésfelismerés egyszerű mintaillesztés). Más nyelvhez a heurisztikát
újra kell hangolni.

---

## 11. ELFOGADÁSI KRITÉRIUMOK

1. Minden generált tábla megoldható (optimum > 0), és a „csak a tábla alapján”
   terv az optimum ≤ 75%-át éri el.
2. Azonos seed azonos táblát ad, karakterre azonos JSON-nal.
3. Egy résztvevő soha nem kap üzenetben olyan tényt, amit senki nem osztott meg.
4. Egy feladatot két egység nem teljesíthet: a második `false` kimenetet kap.
5. A terv módosítása töröl minden korábbi készre jelentkezést.
6. Az 1. kör csak akkor zárul, ha minden csatlakozott ember készre jelentkezett,
   vagy lejárt az idő.
7. A B körben nem parancsnok `assign` üzenete a szerveren javaslattá alakul.
8. A B kör parancsnoka az A körben mért vezetői index alapján kerül kijelölésre.
9. Megszakadó kapcsolat után az azonos külső azonosítóval visszatérő résztvevő
   ugyanazt az ülőhelyet, ugyanazokat a tényeket és ugyanazt a szerepet kapja.
10. Az AI társak legalább egy tényt megosztanak öt percen belül `cooperative`
    stílusban, és képesek kérdésre reagálni.
11. A szoba lezárásakor a `teams`, `team_rounds` és `team_messages` táblákba
    kerül minden kör és minden üzenet.
12. Egyedül, két AI társsal a modul végigjátszható, és mindkét kör eredményt ad.
13. A hang megtagadása nem akadályozza a feladat elvégzését.
14. Az üres szobák három perc tétlenség után felszabadulnak.

**Ellenőrzött végponttól végpontig.** Két élő kliens + két bot, teljes menet
(létrehozás → csatlakozás → brief → 1. kör tényosztással és lezárással →
parancsnok-kijelölés → 2. kör javaslattal → záró pontszám → adatbázis).
Mért eredmény egy példafutáson: elért 70 / optimális 110, megosztás nélkül 40 lett
volna — a rejtett profil hatása közvetlenül látszik.

---

# B VÁLTOZAT — SZERKEZETLELTÁR (`COMMAND_SPATIAL_B`)

Ez a fejezet a modul **B változatát** írja le. Az A változat (1–11. fejezet)
változatlan. A B változat VR-ben és asztali böngészőben is fut, mert a mérés
lényege nem a kontroller, hanem a **nézőpont** — és nézőpontja mindkét
platformon van.

## B/1. Miért van B változat

Az A változat rejtett profil feladat: minden résztvevő más kártyákat kap,
és a helyes döntés csak akkor születik meg, ha megosztják őket. Ez érvényes
csoportdöntési paradigma, de a laposítási teszten megbukik: **az információ
aszimmetriája adminisztratív** — a szerver osztja ki, ki mit tud. Ugyanez
működne egy chatablakban, VR nélkül.

A B változat ugyanazt a konstruktumot méri, de az információt **perceptuálissá**
teszi: a csapat egy fizikai szerkezetet vesz körül, és **mindenki mást lát belőle,
mert máshol ül**. Az aszimmetriát nem a szabály hozza létre, hanem a geometria.
Ez az a különbség, amit VR nélkül nem lehet előállítani.

## B/2. Térbeliség — a modul létjogosultsága

**Laposítási kérdés:** ha minden résztvevő ugyanazt a képet látná, a
`best_single_seat_error`, a `pooling_gain`, a `privileged_blocks`,
a `view_share` és az `allocentric_ratio` mind értelmetlenné válna — és a
feladatnak sem lenne megoldása, mert nem volna mit összeadni. A modul térbeli.

| Affordancia | Metrika |
|---|---|
| **Hidden transform / nézőpont** | `privileged_blocks`, `view_share`, `best_single_seat_error`, `pooling_gain` |
| **Rotation / szilárd testek** | a takarás geometriai: egy kocka valóban eltakar egy másikat |
| **Surround** | a résztvevők körbeülik a szerkezetet, mindenki más szektort lát |
| **Depth** | a takarási sorrend a mélységi elrendezésből adódik |

## B/3. A szerkezet

A jelenet közepén egy **28 kockából** álló, három lebenyre tagolt fürt lebeg
(sugár 0,92 m, magasság 1,45 m). A kockák négy színűek: **PIROS, KÉK, ZÖLD, SÁRGA**.
A résztvevők 2,6 m sugarú körön, egyenletesen elosztva ülnek, szemmagasság 1,6 m.

**A feladat:** hány kocka van az egyes színekből? Egyetlen szám színenként.

Miért nem triviális: **senki nem látja az egészet.** Egy kocka takarásban van,
ha a szemtől hozzá húzott egyenest egy másik kocka elmetszi. A generátor
három tulajdonságot garantál, mindet iteratív ellenőrzéssel és javítással:

| Garancia | Miért kell |
|---|---|
| Egyetlen kockát sem takar el **minden** ülés elől | különben a helyes válasz elérhetetlen |
| **Senki nem lát mindent** | különben elég volna egy embert megkérdezni |
| Minden ülésnek van **privilegizált** rálátása | különben valakinek nincs oka megszólalni |

**Privilegizált** az a kocka, amit a székek **kisebbsége** lát
(`≤ floor(seats/2)`). Ez szándékosan enyhébb, mint a szigorú kizárólagosság:
5 egyenletesen elosztott ülésnél az a kocka, amit négyen nem látnak, az
ötödik elől is takarásban van — a szigorú kizárólagosság ezért 5 fős csapatnál
geometriailag nem garantálható. A rejtett profil szakirodalma is fokozatként
kezeli a meg nem osztott információt, nem bináris tulajdonságként.

A **lebenyes** (nem gömbszerű) alak azért kell, mert egy szimmetrikus gömbfürt
körül minden ülés statisztikailag ugyanazt látja, és nincs mit megosztani.
A lebenyek megtörik ezt a szimmetriát: mindegyik más szektort árnyékol be.

**Validálás.** 480 generált forgatókönyv 2–5 fős csapatokra: 0 láthatatlan
kocka, 0 mindent látó ülés, 0 privilegizált rálátás nélküli ülés, és az
átlagos „egyedül a legjobb helyről” hiba **6,25 kocka**. Azonos seed azonos
szerkezetet ad.

## B/4. Menet

> A körök a protokollban `'A'` és `'B'` néven futnak, de a **képernyőn
> 1. és 2. körként** jelennek meg — különben a „B VÁLTOZAT" és a „B KÖR"
> ugyanazon a képernyőn azt sugallná, hogy összefüggenek. Az adatbázisban és a
> hálózati üzenetekben a jelölés változatlanul `'A'` / `'B'`.

| Fázis | Idő | Tartalom |
|---|---|---|
| lobby | — | csatlakozás, ülés kiosztása |
| briefing | 45 s | a feladat és a saját nézet megismerése |
| **1. kör** | 300 s | mindenki javasolhat, a leltárt bárki módosíthatja, közös lezárás |
| interlude | 30 s | eredmény, parancsnok kijelölése az 1. körös aktivitás alapján |
| **2. kör** | 300 s | **új szerkezet**, a leltárt csak a parancsnok írhatja |
| debrief | — | csapatpontszám, egyéni metrikák |

A 2. kör **új szerkezetet generál** (`seed ^ 0x5bf03635`), tehát az ülések
mást látnak, mint az első körben. Ez megakadályozza, hogy a második kör
puszta memóriafeladat legyen, és megmutatja, tud-e a parancsnok
**mástól** információt beszedni, nem csak a sajátját beírni.

## B/5. Felület

| Panel | Tartalom |
|---|---|
| **Leltártábla** | színenként egy sor, `+` / `−` gombokkal, és egy „A SAJÁT NÉZETEM” gomb, ami a saját látott darabszámot tölti be |
| **NÉZETEM** fül | hány kockát látsz, ebből hány olyan, amit a többség nem lát |
| **RÁDIÓ** fül | rögzített mondatok (lásd lent) |
| **CSAPAT** fül | ki mit jelentett be eddig, és ki készült el |

A rádiómondatok **két keretet** kevernek, és a felület vizuálisan
megkülönbözteti őket:

- **allocentrikus** (a szerkezethez viszonyít: „A szerkezet TETEJÉN van egy.”) — kiemelt gomb
- **egocentrikus** (a beszélőhöz viszonyít: „Tőlem balra van egy, amit ti nem láttok.”) — halvány gomb
- semleges („Vigyázzunk, ezt ketten is látjuk — egyszer számoljuk.”)

Ez a modul második mérése: **kinek a nézőpontjából beszél a résztvevő?**
Az egocentrikus közlés („tőlem balra”) a hallgatónak használhatatlan, mert
a hallgató máshol ül. Az `allocentric_ratio` azt méri, hogy a résztvevő
átvált-e a mindenki számára közös vonatkoztatási rendszerre. Ez a valós
koordinációs helyzetekben (légi irányítás, mentés, kötelékvezetés) a
kommunikációs kompetencia egyik legjobban dokumentált eleme.

**A hálózat soha nem küldi el egy ülésnek, hogy egy másik ülés mit lát.**
A `structure` üzenet a nyilvános geometriát tartalmazza, plusz a *saját*
`visibleBlockIds` listát és a saját `privilegedCount`-ot. Aki más nézetét
akarja tudni, annak meg kell kérdeznie — ezt méri a modul.

## B/6. Metrikák

**Csapatszinten:**

| Metrika | Definíció |
|---|---|
| `inventory_error` | a beadott és a valós színenkénti darabszám abszolút eltéréseinek összege |
| `over_count` / `under_count` | a túl- és alulszámolás **külön**: az egyik kétszer jelentett kocka, a másik be nem tett nézet |
| `best_single_seat_error` | mennyit hibázott volna a legjobb helyen ülő egyedül |
| `pooling_gain` | `best_single_seat_error − inventory_error` — **a modul zászlóshajó-metrikája** |
| `info_coverage` | a ritka (privilegizált) rálátásokból mennyi került be a végeredménybe |

A `pooling_gain` az a szám, amiért az egész modul létezik: pozitív, ha a
csapat többet ért el, mint amennyit a legjobban ülő tagja egyedül elérhetett
volna. Nulla vagy negatív érték azt jelenti, hogy a csoport nem használta ki,
hogy többen vannak — ez a rejtett profil kutatás klasszikus kudarcmintázata.

**Egyénileg:**

| Metrika | Definíció |
|---|---|
| `privileged_blocks` | hány olyan kockát látott, amit a többség nem |
| `view_share` | a szerkezet hány százalékát látta |
| `allocentric_ratio` | az allocentrikus közlések aránya az összes térbeli közlésen belül |
| `time_to_first_share_ms` | mennyi idő telt el, mire először térbeli információt közölt |
| `inventory_edits` | hányszor nyúlt a leltárhoz |
| `privilege_weight` | a látott kockák ritkasággal súlyozott összege |

## B/7. Keresztplatform leképezés

| Elem | VR | Desktop | Besorolás |
|---|---|---|---|
| A szerkezet nézése | fejmozgás, sztereo | egérrel forgatható nézet a saját ülésből | `adapted` |
| Takarás | valós geometriai | ugyanaz a számítás | `equivalent` |
| Leltár szerkesztése | sugár + ravasz | kattintás | `equivalent` |
| Rádió | panelgombok | ugyanazok | `equivalent` |

A takarásszámítás a **szerveren**, geometriailag történik, ugyanazzal a
kóddal mindkét platformra. Ezért egy asztali és egy VR-résztvevő ugyanabban
a szobában játszhat, és a nézetük ugyanúgy korlátozott. A `comparability`
kulcs viszont platformonként külön marad, mert a **sebességjellegű**
metrikák (`time_to_first_share_ms`) nem hasonlíthatók össze.

## B/8. Validáció és korlátok

**Származás.** Stasser és Titus rejtett profil paradigmája, perceptuális
információeloszlással. A vonatkoztatási keretek megkülönböztetése
(egocentrikus / allocentrikus) a téri kogníció standard felosztása; a
`bestSingleSeat` viszonyítás a csoportteljesítmény-kutatás
„legjobb egyéni tag” referenciája.

**Eltérés.** A klasszikus rejtett profil feladatban az információ szöveges és
a kísérletvezető osztja ki. Itt geometriai és a nézőpontból következik,
ami két dolgot ad: a résztvevő **maga fedezi fel**, hogy privilegizált
információja van, és a megosztás minősége (milyen keretben mondja el)
külön mérhetővé válik.

**Elvárt nagyságrend:** `best_single_seat_error` 4–9 kocka, jól működő
csapat `inventory_error`-ja 0–3, `pooling_gain` 3–7. `allocentric_ratio`
képzetlen csapatnál 0,2–0,4, koordinációra kiképzett csapatnál 0,5 fölött.

**Amit nem szabad kikövetkeztetni:** vezetői alkalmasságot. A modul egy
konkrét feladatban megfigyelt koordinációs viselkedést mér, két körben,
ismeretlen csapattal. A parancsnoki szerep kiosztása a mérés eszköze,
nem az eredménye.

**Botok.** Ha a csapat nem teljes, botok töltik fel. A botok a **saját
nézetüket** jelentik be színenként, majd némelyikük hozzá is adja a
táblához — így a duplán számolás valós veszélyként jelenik meg, ahogy
élő csapatnál is. A botok viselkedése a metrikákban jelölt (`isBot`),
és a csapatpontszám értelmezésekor ezt fel kell tüntetni.

## B/8/b. Adatbázis

A `004_team_variants.sql` migráció teszi a B változat eredményét
visszakereshetővé. Enélkül a modul zászlóshajó-mérése elveszne: a
`teams.variant` csak a config JSON-ben szerepelt, a szerkezetleltár kimenete
pedig sehol.

| Tábla / oszlop | Tartalom |
|---|---|
| `teams.variant` | `'A'` vagy `'B'` — önálló oszlop, indexelve, nem JSON-mező |
| `team_rounds.inventory_error` | a beadott leltár abszolút eltérése a valóstól |
| `team_rounds.over_count` / `under_count` | a túl- és alulszámolás külön |
| `team_rounds.best_single_seat_error` | mennyit hibázott volna a legjobb ülés egyedül |
| `team_rounds.submitted_inventory` / `true_inventory` | a beadott és a valós színenkénti darabszám |

A `team_pooling` nézet ezekből számolja a `pooling_gain`-t
(`best_single_seat_error − inventory_error`) körönként. A változat-A körök
`inventory_error`-ja `NULL`, ezért a nézetből automatikusan kimaradnak — a két
változat itt sem keveredik.

Integrációs próba: `node scripts/command-b-e2e.mjs` (futó szerver és adatbázis
mellett) végigjátszik egy teljes ülést két klienssel és botokkal.

## B/9. Elfogadási kritériumok

1. Egyetlen generált szerkezetben sincs olyan kocka, amit senki nem lát.
2. Egyetlen ülés sem látja a szerkezet összes kockáját.
3. Minden ülésnek van legalább 1 privilegizált rálátása, 2–5 fős csapatnál is.
4. A `structure` üzenet soha nem tartalmazza más ülés láthatósági listáját.
5. Azonos seed azonos szerkezetet és ülésbeosztást ad.
6. A 2. kör szerkezete eltér az 1. körétől.
7. A 2. körben a leltárt csak a parancsnok módosíthatja; más próbálkozása elutasításra kerül.
8. A leltár módosítása érvényteleníti a korábbi készenléti jelzéseket.
9. A túl- és alulszámolás külön mezőben kerül az eredménybe.
10. A `pooling_gain` a `best_single_seat_error` és a tényleges hiba különbségeként áll elő, és megjelenik az eredményképernyőn.
11. A rádiómondatok kerete (`egocentric` / `allocentric` / `neutral`) minden elküldött üzenettel naplózódik.
12. A befejezett ülés `teams.variant = 'B'`-vel és körönkénti `inventory_error` /
    `best_single_seat_error` értékkel kerül az adatbázisba; a `team_pooling`
    nézetből lekérdezhető a `pooling_gain`.
13. Ismeretlen területkód esetén a szoba létre sem jön — nem futhat végig egy
    ülés, amit aztán nem lehet elmenteni.
