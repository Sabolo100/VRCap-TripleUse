# Szövegtáblázat — hogyan használd

Ebben a mappában a rendszer **összes felhasználónak megjelenő szövege** egy
táblázatban van, azonosítóval, hogy át tudd nézni és át tudd írni őket.

- **`ui-szovegek.xlsx`** — ezt nyisd meg (Excel, Numbers, Google Sheets).
  Fejléc rögzítve, szűrők bekapcsolva, a szöveges oszlopok tördelnek.
- `ui-szovegek.csv` — ugyanaz, ha valami miatt a csv kényelmesebb.

## Mit csinálj

1. Nyisd meg az xlsx-et, és **szűrj a `KATEGÓRIA` oszlopban**, hogy egyszerre
   egy dolgot nézz.
2. Ahol javítanál, írd be a jó szöveget a **`JAVÍTOTT SZÖVEG`** oszlopba.
   Amit üresen hagysz, azt változatlanul hagyom.
3. Ha valamit inkább csak megjegyeznél („ez a gomb máshol legyen”), írd a
   **`MEGJEGYZÉS`** oszlopba.
4. Mentsd a fájlt ugyanide, és szólj — az `ID` alapján visszamásolom
   mindet a kódba.

## Az oszlopok

| Oszlop | Mit jelent |
|---|---|
| `SOR` | Sorszám, hogy hivatkozni tudj rá szóban is. |
| `ID` | Stabil azonosító, pl. `04.REACT-A.choice.instruction.desktop`. **Ne írd át.** |
| `KATEGÓRIA` | Melyik rétegben látszik a szöveg — lásd lent. |
| `MODUL` | Sorszám + kód, pl. `04 REACT`. |
| `VÁLTOZAT` | `A` / `B` a kétváltozatú moduloknál, egyébként `-`. |
| `HELY` | Melyik blokk vagy melyik metódus. |
| `MEZŐ` | Mi ez a szöveg: blokk címe, instrukció, IRÁNYÍTÁS sor, gombfelirat… |
| `PLATFORM` | `VR` / `asztali` / `mobil`, vagy `mind`, ha mindenhol ugyanaz. |
| `JELENLEGI SZÖVEG` | Ami most megjelenik. |
| `JAVÍTOTT SZÖVEG` | **Ide írj.** |
| `MEGJEGYZÉS` | Szabad szöveg nekem. |
| `FÁJL` | Hol van a kódban — neked nem kell vele foglalkoznod. |

## A négy kategória

| Kategória | Mi ez | Mikor látja a felhasználó |
|---|---|---|
| **1 FELADAT** | Blokkcímek, instrukciók, IRÁNYÍTÁS sorok | A feladat indítása előtti képernyőn. **Ez a legfontosabb.** |
| **2 FUTÁS KÖZBEN** | Státuszsorok, kérdések, gombfeliratok, visszajelzés, eredménysorok | Mérés közben és után. |
| **3 KATALÓGUS** | Modulalcímek, összefoglalók, területi indoklások, változatleírások | A modulkártyán és a kezdőképernyőn. |
| **4 FELÜLET** | Kezdőtér, mobil app, futtató képernyői, területválasztás | A tesztek körül. |

## Amire figyelj a `PLATFORM` oszlopnál

Ahol `VR` / `asztali` / `mobil` külön sor van, ott **eszközönként más a
vezérlő**, és a szövegnek ezt kell tükröznie:

| | VR | Asztali | Mobil |
|---|---|---|---|
| Egygombos válasz | ravasz | SZÓKÖZ vagy kattintás | nevesített gomb a képernyő alján |
| Bal / jobb | bal / jobb ravasz | F és J (vagy ← →) | BAL / JOBB gomb |
| Kijelölés | sugár + ravasz | kattintás | koppintás |
| Második gomb | markolatgomb (grip) | jobb kattintás | külön gomb |
| Körülnézés | fejmozgás | egér húzása | ujj húzása |

Ahol `mind` szerepel, ott a szöveg minden eszközön ugyanaz. Ha egy ilyen
sorhoz eszközfüggő javítást írnál, jelezd a `MEGJEGYZÉS`-ben, és szétbontom
három sorra.

## Újragenerálás

```bash
npx tsx scripts/extract-texts.ts > /tmp/rows.json && python3 scripts/collect_texts.py /tmp
```
