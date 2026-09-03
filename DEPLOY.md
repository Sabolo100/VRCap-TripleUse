# Telepítés — Coolify + Hetzner

Egyetlen konténer szolgálja ki a WebXR klienst és az API-t is, mellette egy
Coolify-kezelt PostgreSQL. A TLS-t a Coolify proxyja (Traefik) zárja le.

---

## A legfontosabb: HTTPS nélkül nincs VR

A WebXR **biztonságos kontextust követel**. Sima `http://` címen a
`navigator.xr` a Quest böngészőjében sem létezik — az alkalmazás betöltődik, a
modulok egérrel/érintéssel futnak, de a „BELÉPÉS VR-BE" gomb nem aktiválható.

Az alkalmazás ezt megkülönbözteti: ha a hiány oka a nem biztonságos kapcsolat,
a gombon **„VR-hez HTTPS kell"** felirat áll, és kiírja, hogy az eszközzel
nincs baj. Ha ezt látod a headsetben, a domain TLS-e a teendő, nem a kód.

---

## Amit a Coolify-nak tudnia kell

| | |
|---|---|
| Build pack | **Dockerfile** (a repó gyökerében) |
| Port | **8080** |
| Health check | **`/api/health`** — adatbázis nélkül is 200-at ad, `database: false` mezővel |
| WebSocket | **`/ws/command`** — a COMMAND modul használja, ugyanazon a porton |
| Perzisztens tároló | **nem kell** az alkalmazásnak; minden állapot az adatbázisban van |

## Környezeti változók

**Futásidejű** (Coolify → Environment Variables):

| Változó | Érték |
|---|---|
| `DATABASE_URL` | a menedzselt Postgres **belső** URL-je |
| `PGSSLMODE` | `disable` |
| `PORT` | `8080` |
| `NODE_ENV` | `production` |
| `AUTO_MIGRATE` | `true` |
| `CORS_ORIGIN` | `*` |
| `STORE_ANONYMOUS_RUNS` | `true` |
| `ADMIN_TOKEN` | tetszőleges hosszú titok, vagy üres |

**Build-idejű** (Coolify → Build → Build Arguments) — csak ha eltérsz az
alapértelmezéstől. A Vite ezeket a bundle-be fordítja, ezért **futásidejű
változóként nem hatnak**:

`VITE_API_BASE`, `VITE_WS_BASE`, `VITE_SHEPARD_URL`

Az egykonténeres telepítéshez mindhárom maradhat alapértelmezetten: a kliens
azonos originről kéri az API-t, és a `wss://`-t az oldal saját protokolljából
vezeti le. **A domain nincs a buildbe égetve**, tehát domainváltáskor nem kell
újraépíteni.

## Migrációk

`AUTO_MIGRATE=true` mellett induláskor lefutnak (`packages/server/src/migrations/`).
Idempotensek, és egy hibájuk naplózódik anélkül, hogy a szervert megállítaná —
ilyenkor az app fut, de nem perzisztál, és a `/api/health` `database: false`-t ad.

## Ellenőrzés telepítés után

```bash
curl -s https://<domain>/api/health
```

Elvárt: `{"ok":true,"database":true,"storage":"postgres",...}`.
Ha `database: false`, a `DATABASE_URL` vagy a belső hálózati elérés a hiba.

A COMMAND többjátékos útvonalához külön integrációs próba tartozik:

```bash
node scripts/command-b-e2e.mjs
```

(Futó szervert és adatbázist igényel; a szkript tetején állítható a cél URL.)

## Helyi futtatás ugyanezzel a képpel

```bash
docker compose up --build
```

A `docker-compose.yml` a saját Postgresét is elindítja — ez a helyi/önálló
változat, Coolify-on csak az `app` rész releváns, az adatbázist a Coolify adja.
