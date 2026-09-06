# 03 — A TÉRBELISÉG KIHASZNÁLÁSA

**Státusz:** kötelező referencia minden modulspecifikációhoz és implementációhoz
**Társdokumentum:** `02-CROSSPLATFORM-INTERACTION.md`

Egy VR-modul akkor rossz, ha egy sík tesztet vetít ki egy térbeli falra.
Ez a dokumentum azt rögzíti, mit jelent a harmadik dimenzió **mérési**
kihasználása, és hogyan kell eldönteni, hogy egy modul megfelel-e.

---

## 1. AZ ALAPKÉRDÉS

> **Ha a jelenetet egyetlen, a résztvevő elé helyezett gömbhéjra lapítanám,
> változna-e bármelyik mérőszám?**

Ha a válasz **nem**, a modul nem használja ki a teret. Nem elég, hogy 3D
motor rajzolja, hogy az objektumok testek, vagy hogy a felhasználó headsetet
visel. Az számít, hogy **a mért érték függ-e a térbeliségtől**.

Ez a kérdés eldöntendő és ellenőrizhető. A meglévő modulokra alkalmazva:

| Modul | Lapítható? | Következmény |
|---|---|---|
| WATCH | nem — 360°, mélység, hátsó szektor | megfelel |
| HOLD | nem — közeledés, pályaítélet | megfelel |
| MEMORY | nem — mélységi rétegek, rejtett forgatás | megfelel |
| NAV | nem — beágyazott mozgás, egocentrikus mutatás | megfelel |
| SIGNAL (A) | **igen** — minden inger egy héjon, 2,4 m-en | B változat kell |
| REACT (A) | **igen** — minden inger z = −2,2 síkon | B változat kell |
| PRESSURE (A) | **igen** — egyetlen központi inger | B változat kell |
| COMMAND (A) | **igen** — vízszintes, sík tábla | B változat kell |
| ANTICIPATE (A) | **igen** — oldalirányú sín fix mélységen | B változat kell |
| FIELD | nem — a mért mennyiség maga szögtartomány | megfelel |
| STEADY | nem — a mérőműszer a 6DoF követés | megfelel |
| RHYTHM | nem — mélységi és perifériás ütempálya | megfelel |
| ADAPT | nem — valódi karmozgás, elevációs transzfer | megfelel |
| MULTI | nem — a négy állomás körülvevő, egyszerre nem látható | megfelel |
| HANDS | nem — peripersonalis manipuláció, csak VR | megfelel |
| RISK | **igen** — a döntés maga nem térbeli | térbeli kiterjesztés kell (lásd lent) |
| PROTOCOL | nem — az eljárás állomásai körülvevő panelen ülnek | megfelel |
| INTENT | nem — testméretű alak, mélységi és perifériás nézet | megfelel |

**A 12–19. modul nem kapott A/B párt**, mert eleve a térbeliségre épült. Az egyetlen
kivétel a RISK: a BART és az Iowa paradigma döntési feladat, aminek nincs térbeli
komponense. Ezt nem B változattal oldjuk meg, hanem azzal, hogy a **kockázat maga
fizikailag közeledik** (lásd `26-MODULE-17-RISK.md` 1. és 5. fejezet): a tét egy
táguló test a karnyújtásnyi térben, és a megállás pillanata a `commitment_fraction`
mintájára folyamatosan megfigyelhető. Ha ez sem lenne igaz, a modul `supports`-a
őszintén jelezné, hogy sík platformon ugyanazt méri.

---

## 2. A HAT TÉRBELI ESZKÖZ

Mindegyikhez tartozik legalább egy mérőszám, amit sík kijelzőn nem lehet
előállítani. Egy modul akkor „elég 3D-s", ha legalább **kettőt** használ
közülük úgy, hogy az a **pontozásba is bekerül**.

### 2.1. Körülvevő elrendezés (surround)

A látómezőn kívülre helyezett inger. A fejfordítás így nem melléktermék,
hanem **a feladat maga**: amit nem nézel, azt nem látod.

**Amit mér:** pásztázási lefedettség és annak entrópiája, hátsó szektor
detekciója, a felügyelt szektor időbeli szűkülése, keresési idő a
szükséges testfordulás függvényében.

**Csapda:** ha az inger mindig visszatér a látómezőbe (pl. forgó rács),
a körülvevő elrendezés önmagában nem kényszerít fordulásra. A mérésnek
olyan eseményt kell tartalmaznia, ami **csak akkor észlelhető, ha
odanéztek**.

### 2.2. Mélység önálló csatornaként

Két objektum azonos irányban, eltérő távolságban. **A szögméretet
állandóan kell tartani** (`depthScale = radius / rNear`), különben a
„távoli" egyszerűen „kisebbet" jelent, és a mélységi manipuláció
méretmanipulációvá esik össze.

**Amit mér:** mélységi tévesztés (jó irány, rossz réteg), mélységi
detekciós költség, mélységi kódolás a memóriában, mélységi keresésvezérlés.

**Csapda:** ha a szögméretet konstansan tartod, a távolságot **csak** a
binokuláris diszparitás és a mozgásparallaxis hordozza. Ez headsetben
létezik, sík képernyőn nem — tehát az ilyen mutató **VR-only**, és a nevének
ezt ki kell mondania.

### 2.3. Közeledés és pálya (approach)

Az inger a résztvevő felé mozog.

**Amit mér:** a határidő fizikai és látható, nem a kísérletvezető által
választott szám; az elköteleződés pillanata folyamatosan megfigyelhető
(`commitment_fraction`); ütközési pálya vs. elkerülő pálya megkülönböztetése
optikai tágulásból; időzítés tau alapján.

**Csapda:** ha a tárgy szögmérete a közeledés alatt nem nő megfelelően,
a tau-jelzés hiányzik, és a feladat pozíciókövetéssé válik.

### 2.4. Karnyújtásnyi tér (peripersonal space)

Az inger elérhető távolságban van, és a válasz **valódi nyúlás**, nem
sugárral mutatás.

**Amit mér:** 3D Fitts-meredekség (a nehézségi index tartalmazza a
mélységi komponenst), propriocepció, vergencia-vezérelt nyúlás,
kétkezes koordináció eltérő mélységben, elfogási pontosság.

**Csapda:** ez a leginkább VR-only eszköz. Sík platformon nincs megfelelője,
tehát az ilyen blokk `supports`-ában nem szerepelhet a `desktop`/`mobile`.

### 2.5. Forgás és tömör test

Az objektumok saját tengelyük körül forognak.

**Amit mér:** önmagában semmit — ez **higiéniai** követelmény, nem mérés.
Egy nem forgó objektum perceptuálisan kép, nem test; a forgás
struktúrát ad a mozgásból, és megakadályozza, hogy a jelenetet lapos
mintázatként lehessen bekódolni.

**Csapda:** a forgás soha nem rejtheti el a diszkriminatív jegyet. Ha a
célt csak bizonyos szögből lehet felismerni, akkor a modul mentális
forgatást mér (SPACE dolga), nem azt, amit mérni akar.

### 2.6. Rejtett transzformáció és nézőpont

A tárolt vagy megosztott térbeli tartalom átalakul, illetve a résztvevők
**különböző nézőpontból** látják ugyanazt.

**Amit mér:** térbeli frissítés költsége (elforgatott elrendezés
felidézése), perceptuális információaszimmetria (kinek mi látszik onnan,
ahol áll), térbeli hivatkozás minősége (egocentrikus vs. allocentrikus
megfogalmazás).

**Csapda:** a transzformációnak **láthatatlannak** kell lennie. Ha látszik
a forgás, a feladat vizuális követés, nem frissítés.

---

## 3. AMI NEM SZÁMÍT TÉRBELISÉGNEK

Ezek gyakori tévedések, és önmagukban egyik sem elég:

- **Az objektumok 3D testek.** Egy kocka és egy négyzet közti különbség
  renderelési kérdés, nem mérési.
- **A panel a térben lebeg.** Egy szövegdoboz 2 m-re a levegőben ugyanaz a
  szövegdoboz.
- **A felhasználó körülnézhet.** A *lehetőség* nem mérés. Akkor mérés, ha a
  feladat kikényszeríti, és a viselkedés rögzül.
- **A jelenetnek mélységi hatása van** (köd, árnyék, perspektíva). Ha egyik
  mérőszám sem függ tőle, díszlet.
- **Headsetben fut.** A hardver nem konstruktum.

---

## 4. A BECSÜLETESSÉG SZABÁLYA

Ha egy mérés a térbeliségből származik, sík platformon **nem szabad
helyette közelítést adni**.

1. A metrika **hiányzik** (nem nulla, nem becsült).
2. A pontozásban a **súlya nulla**, és a maradék súlyok arányosan
   felskálázódnak.
3. Az eredményképernyő **kiírja**, hogy a mutatóhoz VR kell.
4. A futás rögzíti, hogy térbeli súlyozással készült-e
   (`spatialWeightsApplied`).

Egy 0,72-es asztali pontszám és egy 0,72-es VR pontszám nem ugyanaz, és a
rendszer nem tehet úgy, mintha az lenne.

---

## 5. A/B VÁLTOZATOK

Ha egy már elkészült modul nem felel meg az 1. fejezet kérdésének, **nem
kell átírni**. Helyette kap egy **B változatot**, és a felhasználó a modul
kártyáján választ.

| | A változat | B változat |
|---|---|---|
| Célja | bevált, széles platformtámogatás, gyors | a térbeliséget kihasználó mérés |
| Platform | jellemzően VR + asztali + mobil | gyakran csak VR |
| Paradigma | a klasszikus, papír/képernyő elrendezés | ugyanannak a paradigmának a térbeli kiterjesztése |
| Mikor válaszd | összehasonlíthatóság a szakirodalommal, sík eszköz | headset elérhető, és a térbeli konstruktum érdekel |

**Kötelező szabályok:**

- A két változat **külön `configVersion`-t** kap (`<CODE>_STANDARD_A`,
  `<CODE>_SPATIAL_B`), és az eredményeik **soha nem kerülnek egy
  normacsoportba**, sem a ranglistára, sem a profilba súlyozás nélkül.
- A B változat **ugyanazt a konstruktumot** mérje, ne egy másikat. Ha más
  konstruktumot mér, az új modul, nem B változat.
- A B változat is **publikált paradigmán alapuljon**, annak térbeli
  kiterjesztéseként — nem kitalált feladat.
- A modulkártya alján két gomb: `A` és `B`, mindkettő egy szavas címkével.

---

## 6. ELLENŐRZŐLISTA

Egy modulspecifikáció addig nincs kész, amíg ezekre nincs válasz:

- [ ] Megválaszolva az 1. fejezet kérdése: **mi változna, ha lelapítanám?**
- [ ] Legalább **két** térbeli eszköz a 2. fejezetből, és mindkettő
      bekerül a pontozásba.
- [ ] Minden térbeli mérőszámhoz oda van írva, hogy **VR-only**-e.
- [ ] A VR-only mutatók sík platformon **hiányoznak**, nem közelítettek.
- [ ] A pontozási súlyok sík platformon átskálázódnak, és ez rögzül.
- [ ] A szögméret-kompenzáció le van írva, ha van mélységi manipuláció.
- [ ] A forgás nem rejti el a diszkriminatív jegyet.
- [ ] Ha ez B változat: az A-val azonos konstruktum, külön `configVersion`,
      és a publikált paradigma, aminek a kiterjesztése.
- [ ] A térbeli eszköz **mobilon is deklarált**: vagy adaptált paraméterrel fut,
      vagy hiányzik. Nincs csendben leromlott változat (lásd
      `02-CROSSPLATFORM-INTERACTION.md` 4/C).
