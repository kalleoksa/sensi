// Match rules and the keeper, driven through the real session step.
//
// The bugs these cover: goals judged at the end-of-frame position (a rising
// shot that crossed under the bar was given as a goal kick); keepers that
// couldn't touch a ball above ankle height; a stale foul or out-ball firing a
// phantom restart; second-half restarts set up as if the teams hadn't swapped
// ends; sent-off players still controllable; every own-half foul booked; and
// identical kits. The soak test at the end catches the class of loop where the
// deterministic sim replayed the same kickoff-to-goal sequence (0-29).

import { beforeEach, describe, expect, it } from 'vitest';
import { installWindow } from './support/harness';
import { makeSession, stepSession, type ControlMode, type Session } from '../src/session';
import { resolvePossession } from '../src/player';
import { TEAMS, awayKit } from '../src/teams/data';
import { DEFAULT_FORMATION, FORMATION_IDS } from '../src/formations';
import { PITCHES } from '../src/options';
import { CX, FIELD_B, FIELD_T, GOAL_HEIGHT } from '../src/world';
import { Dir, type Player } from '../src/state';

const DT = 1 / 60;

beforeEach(() => {
  installWindow();
});

function session(controlMode: ControlMode = 'cpu', seed?: number): Session {
  return makeSession({
    home: TEAMS[0],
    away: TEAMS[1],
    controlMode,
    homeFormation: DEFAULT_FORMATION,
    awayFormation: DEFAULT_FORMATION,
    halfLength: 90,
    pitch: PITCHES[0],
    seed,
  });
}

// Skip the kickoff freeze and park everyone well away from the ball so a test
// can place the ball without anybody interfering.
function livePlay(s: Session): void {
  s.match.phase = 'play';
  for (const p of s.state.players) {
    p.x = CX + (p.team === 0 ? -150 : 150);
    p.y = (FIELD_T + FIELD_B) / 2;
    p.prevX = p.x;
    p.prevY = p.y;
  }
}

function keeper(s: Session, team: 0 | 1): Player {
  return s.state.players.find((p) => p.team === team && p.role === 'gk')!;
}

function outfielder(s: Session, team: 0 | 1, i = 0): Player {
  return s.state.players.filter((p) => p.team === team && p.role !== 'gk')[i];
}

describe('goal line', () => {
  it('judges the goal where the ball crossed, not where the frame ended', () => {
    const s = session();
    livePlay(s);
    const b = s.state.ball;
    // Just in front of the top goal, under the bar, rising steeply: it crosses
    // the line below GOAL_HEIGHT but finishes the step above it.
    b.x = b.prevX = CX;
    b.y = b.prevY = FIELD_T + 1;
    b.z = b.prevZ = GOAL_HEIGHT - 2;
    b.vx = 0;
    b.vy = -300;
    b.vz = 500;
    b.controlLock = 1;
    stepSession(s, DT);
    expect(b.z).toBeGreaterThan(GOAL_HEIGHT);
    expect(s.match.score).toEqual([1, 0]); // team 0 attacks the top in half 1
  });
});

describe('keeper', () => {
  it('claims a ball at chest height inside his box', () => {
    const s = session();
    livePlay(s);
    const gk = keeper(s, 1); // defends the top goal in half 1
    gk.x = CX;
    gk.y = FIELD_T + 7;
    const b = s.state.ball;
    b.x = gk.x;
    b.y = gk.y + 4;
    b.z = 10;
    b.vx = b.vy = 0;
    b.controlLock = 0;
    resolvePossession(s.state, DT);
    expect(s.state.carrier).toBe(gk);
  });

  it("can save an opponent's shot the moment it is struck", () => {
    const s = session();
    livePlay(s);
    const gk = keeper(s, 1);
    gk.x = CX;
    gk.y = FIELD_T + 7;
    const b = s.state.ball;
    b.x = gk.x;
    b.y = gk.y + 4;
    b.z = 2;
    b.vx = 0;
    b.vy = -100; // a soft shot: always held
    b.owner = outfielder(s, 0);
    b.controlLock = 0.2; // the post-kick lock
    resolvePossession(s.state, DT);
    expect(s.state.carrier).toBe(gk);
  });

  it('does not always hold a hard shot', () => {
    let held = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = session('cpu', seed);
      livePlay(s);
      const gk = keeper(s, 1);
      gk.x = CX;
      gk.y = FIELD_T + 7;
      const b = s.state.ball;
      b.x = gk.x;
      b.y = gk.y + 4;
      b.z = 2;
      b.vx = 0;
      b.vy = -380;
      b.owner = outfielder(s, 0);
      b.controlLock = 0.2;
      resolvePossession(s.state, DT);
      if (s.state.carrier === gk) held++;
    }
    expect(held).toBeGreaterThan(5);
    expect(held).toBeLessThan(35);
  });
});

describe('fouls and restarts', () => {
  it('a foul during the run-off replaces the pending out-ball', () => {
    const s = session();
    livePlay(s);
    s.match.outBall = { kind: 'throw', team: 1, x: 60, y: 200 };
    s.match.outTimer = 0.3;
    s.state.foul = { team: 0, x: CX, y: 300, offender: outfielder(s, 1), deniedAttack: false };
    stepSession(s, DT);
    expect(s.match.outBall).toBeNull();
    expect(s.match.restart?.kind).toBe('freekick');
  });

  it('a foul on the final whistle of a half does not carry over', () => {
    const s = session();
    livePlay(s);
    s.match.clock = DT / 2;
    s.state.foul = { team: 0, x: CX, y: 300, offender: outfielder(s, 1), deniedAttack: false };
    for (let i = 0; i < 60 * 4 && s.match.half === 1; i++) stepSession(s, DT);
    expect(s.match.half).toBe(2);
    expect(s.state.foul).toBeNull();
    expect(s.match.restart).toBeNull();
  });

  it('stands a second-half free-kick taker on his own side of the ball', () => {
    const s = session();
    livePlay(s);
    s.match.clock = DT / 2;
    for (let i = 0; i < 60 * 8 && !(s.match.half === 2 && s.match.phase === 'play'); i++) stepSession(s, DT);
    expect(s.match.half).toBe(2);
    livePlay(s);
    // Team 0 attacks the BOTTOM goal in half 2, so its own side is above (−y).
    s.state.foul = { team: 0, x: CX, y: 250, offender: outfielder(s, 1), deniedAttack: false };
    stepSession(s, DT);
    const taker = s.match.restart!.taker;
    expect(taker.attacksTop).toBe(false);
    expect(taker.y).toBeLessThan(s.state.ball.y);
  });

  it('books only a foul that stops the carrier (or concedes a penalty)', () => {
    const s = session();
    livePlay(s);
    const off = outfielder(s, 1); // team 1 defends the top half in half 1
    s.state.foul = { team: 0, x: CX, y: FIELD_T + 150, offender: off, deniedAttack: false };
    stepSession(s, DT);
    expect(off.yellow).toBe(false);

    livePlay(s);
    s.match.restart = null;
    s.state.foul = { team: 0, x: CX, y: FIELD_T + 150, offender: off, deniedAttack: true };
    stepSession(s, DT);
    expect(off.yellow).toBe(true);
  });
});

describe('possession', () => {
  // Carrier at the centre spot facing up (toward the top goal), ball at his feet.
  function carrierSetup(): { s: Session; c: Player } {
    const s = session();
    livePlay(s);
    const c = outfielder(s, 0);
    c.x = CX;
    c.y = 300;
    c.dir = Dir.U;
    const b = s.state.ball;
    b.x = c.x;
    b.y = c.y - 6;
    b.z = 0;
    b.vx = b.vy = 0;
    b.controlLock = 0;
    s.state.carrier = c;
    return { s, c };
  }

  it('front contact wins the ball; a nearer rival alone does not', () => {
    const { s, c } = carrierSetup();
    const o = outfielder(s, 1);
    // A rival nearer the ball but not yet in contact: the carrier keeps it.
    o.x = c.x + 9;
    o.y = c.y - 9;
    resolvePossession(s.state, DT);
    expect(s.state.carrier).toBe(c);
    // Stepping in front of him (contact) knocks it loose.
    o.x = c.x;
    o.y = c.y - 6;
    resolvePossession(s.state, DT);
    expect(s.state.carrier).toBeNull();
    expect(c.beatenTimer).toBeGreaterThan(0);
  });

  it('contact from behind rarely wins it', () => {
    let kept = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { s, c } = carrierSetup();
      s.state.rng.setState(seed);
      const o = outfielder(s, 1);
      o.x = c.x;
      o.y = c.y + 6; // right behind him
      resolvePossession(s.state, DT);
      if (s.state.carrier === c) kept++;
    }
    expect(kept).toBeGreaterThanOrEqual(15);
  });
});

describe('sent-off players', () => {
  it('are never handed to the human', () => {
    const s = session('1p');
    livePlay(s);
    const off = outfielder(s, 0);
    off.sentOff = true;
    const b = s.state.ball;
    off.x = b.x;
    off.y = b.y;
    stepSession(s, DT);
    expect(s.state.controlled).not.toBeNull();
    expect(s.state.controlled).not.toBe(off);
  });
});

describe('kits', () => {
  it('gives the away side a change strip on a shirt clash', () => {
    const eng = TEAMS.find((t) => t.id === 'eng')!;
    const cro = TEAMS.find((t) => t.id === 'cro')!;
    const fra = TEAMS.find((t) => t.id === 'fra')!;
    expect(awayKit(eng.kit, cro.kit).shirt).not.toEqual(eng.kit.shirt);
    expect(awayKit(eng.kit, fra.kit)).toBe(fra.kit); // no clash: home strip
  });
});

describe('CPU v CPU soak', () => {
  it('plays full matches with no stalls, loops or card floods', { timeout: 60000 }, () => {
    const results: number[][] = [];
    for (let m = 0; m < 6; m++) {
      const s = makeSession({
        home: TEAMS[m],
        away: TEAMS[m + 6],
        controlMode: 'cpu',
        homeFormation: FORMATION_IDS[m % FORMATION_IDS.length],
        awayFormation: FORMATION_IDS[(m * 3 + 1) % FORMATION_IDS.length],
        halfLength: 120,
        pitch: PITCHES[m % PITCHES.length],
        seed: 1000 + m,
      });
      let still = 0;
      let maxStill = 0;
      let steps = 0;
      while (s.match.phase !== 'fulltime' && steps < 60 * 60 * 10) {
        stepSession(s, DT);
        steps++;
        const b = s.state.ball;
        const idle = s.match.phase === 'play' && !s.state.carrier && Math.hypot(b.vx, b.vy) < 1;
        still = idle ? still + 1 : 0;
        maxStill = Math.max(maxStill, still);
      }
      expect(s.match.phase).toBe('fulltime');
      expect(maxStill, 'a dead ball left lying in open play').toBeLessThan(60 * 5);
      expect(s.state.players.filter((p) => p.sentOff).length).toBeLessThanOrEqual(2);
      results.push([...s.match.score]);
    }
    for (const [h, a] of results) expect(h + a, `scoreline ${h}-${a}`).toBeLessThanOrEqual(8);
  });
});
