/**
 * TrialMachine behaviour, driven by a fake clock so the sequence is exact and
 * the test does not depend on a real animation loop.
 */
import { TrialMachine, type TrialPhase } from '../packages/client/src/engine/task/TrialMachine.js';
import { Clock } from '../packages/client/src/engine/core/Clock.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}`, extra ?? ''); failures++; }
}

// A Clock whose frameTime we control directly.
class FakeClock extends Clock {
  set(t: number) { this.beginFrame(t); }
}

console.log('TrialMachine');

{
  const clock = new FakeClock();
  clock.set(0);
  const seen: string[] = [];
  const durations: Record<string, number> = {
    prepare: 100, countdown: 0, stimulus: 200, response_window: 0,
    response: 0, feedback: 50, inter_trial: 50,
  };
  let completed = false;
  const m = new TrialMachine(clock, {
    trialCount: 3,
    duration: (p) => durations[p] ?? 0,
    onEnter: (p, trial) => seen.push(`${trial}:${p}`),
    onComplete: () => { completed = true; },
  });
  m.start();
  for (let t = 0; t <= 3000; t += 10) {
    clock.set(t);
    m.update(0.01);
  }

  check('completes all trials', completed);
  check('trial index reaches 3', m.trial === 3, m.trial);
  check('phase is done', m.phase === 'done', m.phase);

  const trial0 = seen.filter((s) => s.startsWith('0:')).map((s) => s.split(':')[1]);
  const expected: TrialPhase[] = [
    'prepare', 'countdown', 'stimulus', 'response_window', 'response', 'feedback', 'inter_trial',
  ];
  check('trial 0 visits every phase in order', JSON.stringify(trial0) === JSON.stringify(expected), trial0);

  const trialsStarted = new Set(seen.map((s) => s.split(':')[0])).size;
  check('exactly 3 trials ran', trialsStarted === 3, trialsStarted);
}

{
  // An early response should be able to skip straight to feedback.
  const clock = new FakeClock();
  clock.set(0);
  const m = new TrialMachine(clock, {
    trialCount: 1,
    duration: (p) => (p === 'stimulus' ? 5000 : p === 'prepare' ? 50 : 10),
  });
  m.start();
  for (let t = 0; t <= 60; t += 10) { clock.set(t); m.update(0.01); }
  check('reaches stimulus', m.phase === 'stimulus', m.phase);
  m.goto('feedback');
  check('goto jumps phase', m.phase === 'feedback', m.phase);
}

{
  // Pausing must not credit elapsed time to the current phase - otherwise a
  // headset going to sleep mid-trial would silently time the trial out.
  const clock = new FakeClock();
  clock.set(0);
  const m = new TrialMachine(clock, { trialCount: 1, duration: () => 100 });
  m.start();
  clock.set(50); m.update(0.05);
  m.pause();
  clock.set(5000);
  m.update(0.05);
  check('paused machine does not advance', m.phase === 'prepare', m.phase);
  m.resume();
  clock.set(5050); m.update(0.05);
  check('resume restarts the phase clock', m.phase === 'prepare', m.phase);
  clock.set(5160); m.update(0.05);
  check('advances after the full duration post-resume', m.phase !== 'prepare', m.phase);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
