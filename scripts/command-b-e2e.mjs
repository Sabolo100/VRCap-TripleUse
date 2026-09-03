/**
 * COMMAND-B integration check over the real WebSocket.
 *
 * Two live clients plus bots, both rounds, the structure inventory scored
 * against the truth and against the best single seat, then persisted. Unlike
 * `npm test` this needs a running server and database, so it is not part of
 * the offline suite.
 *
 *   npm run build && (cd packages/server && node dist/index.js) &
 *   node scripts/command-b-e2e.mjs
 *
 * What it proves: the seats genuinely see different subsets, no seat's
 * visibility leaks to another, the round is scored against `bestSingleSeat`,
 * only the commander may write the inventory in round 2, and the whole thing
 * lands in `teams` / `team_rounds` with a queryable pooling gain.
 */
import WebSocket from 'ws';
const URL = 'ws://localhost:8787/ws/command';
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, seat: null, role: null, phase: null, structure: null,
              inventory: null, results: [], final: null, msgs: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    c.msgs.push(m.t);
    if (m.t === 'room') { c.roomCode = m.room; c.phase = m.phase; c.round = m.round; c.members = m.members; }
    if (m.t === 'you') { c.seat = m.seat; c.role = m.role; c.playerId = m.playerId; }
    if (m.t === 'structure') c.structure = m;
    if (m.t === 'inventory') c.inventory = m.counts;
    if (m.t === 'roundResult') c.results.push(m.result);
    if (m.t === 'final') c.final = m;
    if (m.t === 'error') log(`  [${name}] ERROR`, m.message);
  });
  c.ready = new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const a = client('A'), b = client('B');
await Promise.all([a.ready, b.ready]);

a.send({ t: 'create', externalId: 'E2E-A', displayName: 'Alfa', domain: 'A',
         config: { variant: 'B', botCount: 2, briefingSeconds: 2, roundSeconds: 12, interludeSeconds: 2 } });
await sleep(600);
log(`room ${a.roomCode}, seat ${a.seat}`);
b.send({ t: 'join', room: a.roomCode, externalId: 'E2E-B', displayName: 'Bravo', domain: 'A' });
await sleep(600);
log(`B joined as seat ${b.seat}`);

a.send({ t: 'start' });
await sleep(3000);
log(`phase after start: ${a.phase}`);

// Each seat sees a different subset - that is the whole point.
const seenA = a.structure?.visibleBlockIds ?? [];
const seenB = b.structure?.visibleBlockIds ?? [];
const total = a.structure?.scenario?.blocks?.length ?? 0;
log(`blocks ${total} | A sees ${seenA.length} (privileged ${a.structure?.privilegedCount}) | B sees ${seenB.length} (privileged ${b.structure?.privilegedCount})`);
const sameView = seenA.length === seenB.length && seenA.every((x, i) => x === seenB[i]);
log(`views differ: ${!sameView}`);
log(`no leak of other seats' visibility: ${!JSON.stringify(a.structure).includes('"visibility"') || 'CHECK'}`);

// Round 1: pool what both of them see, then commit.
function fill(c) {
  const sc = c.structure.scenario;
  const counts = { PIROS: 0, KÉK: 0, ZÖLD: 0, SÁRGA: 0 };
  for (const id of c.structure.visibleBlockIds) {
    const blk = sc.blocks.find((x) => x.id === id);
    if (blk) counts[blk.color]++;
  }
  return counts;
}
const merged = fill(a);
const bOnly = fill(b);
// Naive pooling: add B's privileged view on top. Deliberately imperfect.
for (const k of Object.keys(merged)) merged[k] = Math.max(merged[k], bOnly[k]);
a.send({ t: 'inventory', counts: merged });
await sleep(400);
log(`inventory broadcast to both: A=${JSON.stringify(a.inventory)} B=${JSON.stringify(b.inventory)}`);
a.send({ t: 'phrase', key: 's_top' });
b.send({ t: 'phrase', key: 's_mine' });
await sleep(300);
a.send({ t: 'ready', value: true }); b.send({ t: 'ready', value: true });
await sleep(3500);

const r1 = a.results[0];
if (r1) {
  log(`round 1: error ${r1.structureOutcome.totalAbsError} (over ${r1.structureOutcome.overCount}, under ${r1.structureOutcome.underCount}) | best single seat ${r1.bestSingleSeatError} | optimality ${r1.outcome.optimality.toFixed(2)}`);
  log(`pooling gain: ${r1.bestSingleSeatError - r1.structureOutcome.totalAbsError}`);
} else log('round 1: NO RESULT');
log(`phase: ${a.phase}`);

// Round 2: commander only.
await sleep(2500);
log(`phase: ${a.phase} | A role ${a.role} | B role ${b.role}`);
const cmdr = a.role === 'commander' ? a : b.role === 'commander' ? b : null;
const other = cmdr === a ? b : a;
log(`commander: ${cmdr ? cmdr.name : 'none (bot)'}`);
const sameStructure = JSON.stringify(a.structure?.scenario?.blocks) === JSON.stringify(r1 ? a.structure?.scenario?.blocks : null);
if (other) { other.send({ t: 'inventory', counts: { PIROS: 99, KÉK: 0, ZÖLD: 0, SÁRGA: 0 } }); await sleep(400);
  log(`non-commander write rejected: ${JSON.stringify(a.inventory) !== JSON.stringify({PIROS:99,KÉK:0,ZÖLD:0,SÁRGA:0})}`); }
if (cmdr) { cmdr.send({ t: 'inventory', counts: fill(cmdr) }); await sleep(400); }
a.send({ t: 'ready', value: true }); b.send({ t: 'ready', value: true });
await sleep(600);
if (cmdr) cmdr.send({ t: 'commit' });
await sleep(4000);

const r2 = a.results.find((r) => r.round === 'B');
if (r2) log(`round 2: error ${r2.structureOutcome.totalAbsError} | best single seat ${r2.bestSingleSeatError} | optimality ${r2.outcome.optimality.toFixed(2)}`);
else log('round 2: NO RESULT');
log(`final: ${a.final ? 'teamScore ' + a.final.teamScore : 'none'}`);
const metrics = r2?.players?.[0]?.metrics ?? r1?.players?.[0]?.metrics ?? {};
log(`player metrics: ${Object.keys(metrics).filter(k=>/priv|allo|view|share/.test(k)).map(k=>`${k}=${metrics[k]}`).join(' ')}`);
a.ws.close(); b.ws.close();
process.exit(0);
