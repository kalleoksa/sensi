// App shell: a small screen state machine above the match. Owns the menus
// (title -> main menu -> friendly setup -> team select) and the live match
// session. The fixed loop calls update(dt) then draw(alpha); each dispatches on
// the current screen. The match itself is unchanged — it just no longer boots
// at module load; a session is created on demand when a Friendly launches.

import { VIEW_W, VIEW_H, FIELD_T, FIELD_B } from './world';
import { drawText, drawTextCentered } from './sprites/font';
import { makeList, listMove, drawList, DEFAULT_STYLE, type ListStyle, type ListView } from './menu';
import { consumeMenuInput, consumeMatchControls, clearActionEdges } from './input';
import { emitSfx, setCrowdIntensity } from './audio';
import {
  makeSession,
  stepSession,
  restartSession,
  type Session,
  type ControlMode,
} from './session';
import { CONTINENTS, TEAMS, teamsIn, type TeamDef, type Kit } from './teams/data';
import {
  FORMATION_IDS,
  FORMATION_NAMES,
  FORMATIONS,
  DEFAULT_FORMATION,
  type FormationId,
  type Slot,
} from './formations';
import { MATCH_LENGTHS, PITCHES, DEFAULT_OPTIONS, type MatchOptions } from './options';
import {
  makeCompetition,
  yourFixture,
  recordYourResult,
  simRound,
  advance,
  leagueTable,
  cupRoundName,
  type Competition,
  type CompetitionKind,
} from './competition';
import { css } from './sprites/palette';

type AppScreen =
  | 'title'
  | 'mainMenu'
  | 'friendlySetup'
  | 'teamSelect'
  | 'preMatch'
  | 'options'
  | 'match'
  | 'postMatch'
  | 'compHub'
  | 'compResults'
  | 'compEnd';

const POSTMATCH_ITEMS = ['PLAY AGAIN', 'MAIN MENU'];
const FULLTIME_HOLD = 3; // seconds the FULL TIME overlay holds before the result screen

const MAIN_ITEMS = ['FRIENDLY', 'CUP', 'LEAGUE', 'SPECIALS', 'OPTIONS', 'EDIT TEAMS'];
const MAIN_ENABLED = [true, true, true, false, true, false];

const FRIENDLY_ITEMS = ['1 PLAYER', '2 PLAYERS', 'CPU V CPU'];
const FRIENDLY_MODES: ControlMode[] = ['1p', '2p', 'cpu'];

interface TeamSelectState {
  picking: 'home' | 'away';
  level: 'continent' | 'team';
  continent: number; // index into CONTINENTS
  home: TeamDef | null;
  list: ListView;
}

// Pre-match formation pick. queue holds the human side(s) that still need to
// choose (0 = home/P1, 1 = away/P2); index walks through them.
interface PreMatchState {
  queue: (0 | 1)[];
  index: number;
  formIdx: number; // into FORMATION_IDS
}

// Role colours for the formation diagram dots.
const ROLE_DOT: Record<Slot['role'], string> = {
  gk: 'rgb(248,236,120)',
  def: 'rgb(120,170,235)',
  mid: 'rgb(232,236,222)',
  fwd: 'rgb(235,120,120)',
};

// --- palette (clean custom retro, not a pixel-exact SWOS clone) -------------
const BG = 'rgb(22,56,30)';
const BAND = 'rgb(16,40,22)';
const ACCENT = 'rgb(40,150,78)';
const TITLE = 'rgb(248,236,120)';
const SUBTLE = 'rgb(150,176,120)';

// Compact list spacing for the team browser (the 8-team Europe group is the
// tallest and must leave room for the kit preview below).
const TEAM_STYLE: ListStyle = { ...DEFAULT_STYLE, lineGap: 2 };

export interface AppDeps {
  ctx: CanvasRenderingContext2D;
  renderMatch: (session: Session, alpha: number) => void;
}

export interface App {
  update: (dt: number) => void;
  draw: (alpha: number) => void;
}

export function makeApp(deps: AppDeps): App {
  const { ctx, renderMatch } = deps;

  let screen: AppScreen = 'title';
  let frames = 0; // for the title blink
  let session: Session | null = null;
  let pendingMode: ControlMode = '1p';

  // Match setup carried across the friendly screens.
  let awayTeam: TeamDef | null = null;
  let homeFormation: FormationId = DEFAULT_FORMATION;
  let awayFormation: FormationId = DEFAULT_FORMATION;
  const options: MatchOptions = { ...DEFAULT_OPTIONS };
  let optCursor = 0; // which Options row is active (0 = length, 1 = pitch)

  // Competition state (Cup / League). The team browser is shared with the
  // friendly flow; tsPurpose decides whether picking a team starts a match or a
  // competition.
  let tsPurpose: 'friendly' | 'competition' = 'friendly';
  let pendingComp: CompetitionKind = 'league';
  let competition: Competition | null = null;

  const mainMenu = makeList(MAIN_ITEMS, MAIN_ENABLED);
  const friendly = makeList(FRIENDLY_ITEMS);
  const ts: TeamSelectState = {
    picking: 'home',
    level: 'continent',
    continent: 0,
    home: null,
    list: makeList([...CONTINENTS]),
  };
  const pm: PreMatchState = { queue: [], index: 0, formIdx: 0 };
  const postMatch = makeList(POSTMATCH_ITEMS);
  let fullTimeTimer = 0; // counts the FULL TIME hold before the result screen

  // Dev handles for inspection/testing (mirrors the old __game/__match hooks).
  (window as unknown as { __sensi?: () => Session | null }).__sensi = () => session;
  (window as unknown as { __sensiDev?: unknown }).__sensiDev = {
    session: () => session,
    competition: () => competition,
    quickMatch: (pitchIndex?: number) => {
      if (typeof pitchIndex === 'number') options.pitchIndex = pitchIndex;
      ts.home = TEAMS[0];
      awayTeam = TEAMS[8];
      pendingMode = 'cpu';
      launchMatch();
    },
    quickComp: (kind: CompetitionKind) => {
      competition = makeCompetition(kind, [...TEAMS], TEAMS[0], Date.now() >>> 0);
      pendingMode = '1p';
      screen = 'compHub';
    },
    // Deterministic single-step for debugging: run n fixed sim ticks regardless
    // of the (throttled) rAF loop or pause state.
    step: (n = 1) => {
      if (!session) return;
      const wasPaused = session.paused;
      session.paused = false;
      for (let i = 0; i < n; i++) stepSession(session, 1 / 60);
      session.paused = wasPaused;
    },
  };

  const sideFormation = (side: 0 | 1): FormationId => (side === 0 ? homeFormation : awayFormation);

  function nav(list: ListView, up: boolean, down: boolean): void {
    if (up && listMove(list, -1)) emitSfx('uiMove');
    if (down && listMove(list, 1)) emitSfx('uiMove');
  }

  function enterTeamSelect(): void {
    tsPurpose = 'friendly';
    ts.picking = 'home';
    ts.level = 'continent';
    ts.home = null;
    awayTeam = null;
    homeFormation = DEFAULT_FORMATION;
    awayFormation = DEFAULT_FORMATION;
    ts.list = makeList([...CONTINENTS]);
    screen = 'teamSelect';
  }

  function enterCompetition(kind: CompetitionKind): void {
    tsPurpose = 'competition';
    pendingComp = kind;
    ts.level = 'continent';
    ts.home = null;
    homeFormation = DEFAULT_FORMATION;
    awayFormation = DEFAULT_FORMATION;
    ts.list = makeList([...CONTINENTS]);
    screen = 'teamSelect';
  }

  // Begin the player's match for the current competition fixture.
  function playCompMatch(): void {
    if (!competition) return;
    const f = yourFixture(competition);
    if (!f) return;
    const opp = f.a === competition.you ? f.b : f.a;
    ts.home = competition.you; // the player always controls the home slot (team 0)
    awayTeam = opp;
    pendingMode = '1p';
    beginPreMatch();
  }

  // After both teams are chosen, each human side picks a formation; CPU sides
  // keep the default. With no human sides (CPU v CPU) we launch straight away.
  function beginPreMatch(): void {
    const queue: (0 | 1)[] = [];
    if (pendingMode !== 'cpu') queue.push(0); // home is P1
    if (pendingMode === '2p') queue.push(1); // away is P2
    if (queue.length === 0) {
      launchMatch();
      return;
    }
    pm.queue = queue;
    pm.index = 0;
    pm.formIdx = FORMATION_IDS.indexOf(sideFormation(queue[0]));
    screen = 'preMatch';
  }

  function launchMatch(): void {
    if (!ts.home || !awayTeam) return;
    session = makeSession({
      home: ts.home,
      away: awayTeam,
      controlMode: pendingMode,
      homeFormation,
      awayFormation,
      halfLength: MATCH_LENGTHS[options.lengthIndex].half,
      pitch: PITCHES[options.pitchIndex],
    });
    clearActionEdges(); // don't let the confirming keypress leak in as a kick
    fullTimeTimer = 0;
    screen = 'match';
    emitSfx('uiSelect');
  }

  // --- per-screen updates ---------------------------------------------------

  function updateTitle(): void {
    const m = consumeMenuInput();
    if (m.confirm) {
      emitSfx('uiSelect');
      screen = 'mainMenu';
    }
  }

  function updateMainMenu(): void {
    const m = consumeMenuInput();
    nav(mainMenu, m.up, m.down);
    if (m.confirm && mainMenu.enabled[mainMenu.cursor]) {
      emitSfx('uiSelect');
      const label = mainMenu.items[mainMenu.cursor];
      if (label === 'FRIENDLY') {
        friendly.cursor = 0;
        screen = 'friendlySetup';
      } else if (label === 'CUP') {
        enterCompetition('cup');
      } else if (label === 'LEAGUE') {
        enterCompetition('league');
      } else if (label === 'OPTIONS') {
        optCursor = 0;
        screen = 'options';
      }
    }
    if (m.back) screen = 'title';
  }

  function updateFriendly(): void {
    const m = consumeMenuInput();
    nav(friendly, m.up, m.down);
    if (m.confirm) {
      pendingMode = FRIENDLY_MODES[friendly.cursor];
      emitSfx('uiSelect');
      enterTeamSelect();
    }
    if (m.back) screen = 'mainMenu';
  }

  function updateTeamSelect(): void {
    const m = consumeMenuInput();
    nav(ts.list, m.up, m.down);

    if (m.back) {
      emitSfx('uiSelect');
      if (ts.level === 'team') {
        ts.level = 'continent';
        ts.list = makeList([...CONTINENTS]);
        ts.list.cursor = ts.continent;
      } else if (ts.picking === 'away') {
        // Step back from picking away to re-pick home.
        ts.picking = 'home';
        ts.home = null;
        ts.list = makeList([...CONTINENTS]);
      } else {
        screen = tsPurpose === 'competition' ? 'mainMenu' : 'friendlySetup';
      }
      return;
    }

    if (!m.confirm) return;
    emitSfx('uiSelect');
    if (ts.level === 'continent') {
      ts.continent = ts.list.cursor;
      ts.level = 'team';
      ts.list = makeList(teamsIn(CONTINENTS[ts.continent]).map((t) => t.name));
      return;
    }
    // Team level: a nation was chosen.
    const chosen = teamsIn(CONTINENTS[ts.continent])[ts.list.cursor];
    if (tsPurpose === 'competition') {
      competition = makeCompetition(pendingComp, [...TEAMS], chosen, Date.now() >>> 0);
      pendingMode = '1p';
      screen = 'compHub';
      return;
    }
    if (ts.picking === 'home') {
      ts.home = chosen;
      ts.picking = 'away';
      ts.level = 'continent';
      ts.list = makeList([...CONTINENTS]);
    } else if (ts.home) {
      awayTeam = chosen;
      beginPreMatch();
    }
  }

  function updatePreMatch(): void {
    const m = consumeMenuInput();
    const n = FORMATION_IDS.length;
    if (m.up || m.left) {
      pm.formIdx = (pm.formIdx - 1 + n) % n;
      emitSfx('uiMove');
    }
    if (m.down || m.right) {
      pm.formIdx = (pm.formIdx + 1) % n;
      emitSfx('uiMove');
    }
    if (m.back) {
      emitSfx('uiSelect');
      if (pm.index === 0) {
        // Step back to re-pick the away team.
        ts.picking = 'away';
        ts.level = 'continent';
        ts.list = makeList([...CONTINENTS]);
        screen = 'teamSelect';
      } else {
        pm.index--;
        pm.formIdx = FORMATION_IDS.indexOf(sideFormation(pm.queue[pm.index]));
      }
      return;
    }
    if (m.confirm) {
      emitSfx('uiSelect');
      const id = FORMATION_IDS[pm.formIdx];
      if (pm.queue[pm.index] === 0) homeFormation = id;
      else awayFormation = id;
      pm.index++;
      if (pm.index >= pm.queue.length) {
        launchMatch();
      } else {
        pm.formIdx = FORMATION_IDS.indexOf(sideFormation(pm.queue[pm.index]));
      }
    }
  }

  function updateOptions(): void {
    const m = consumeMenuInput();
    if (m.up && optCursor > 0) {
      optCursor--;
      emitSfx('uiMove');
    }
    if (m.down && optCursor < 1) {
      optCursor++;
      emitSfx('uiMove');
    }
    const delta = (m.left ? -1 : 0) + (m.right ? 1 : 0);
    if (delta !== 0) {
      if (optCursor === 0) {
        const len = MATCH_LENGTHS.length;
        options.lengthIndex = (options.lengthIndex + delta + len) % len;
      } else {
        const len = PITCHES.length;
        options.pitchIndex = (options.pitchIndex + delta + len) % len;
      }
      emitSfx('uiMove');
    }
    if (m.back || m.confirm) {
      emitSfx('uiSelect');
      screen = 'mainMenu';
    }
  }

  function enterPostMatch(): void {
    postMatch.cursor = 0;
    screen = 'postMatch';
    emitSfx('uiSelect');
  }

  function updateMatch(dt: number): void {
    if (!session) return;
    const c = consumeMatchControls();

    // Full time: hold the FULL TIME overlay for a beat (Esc skips), then show
    // the result screen with PLAY AGAIN / MAIN MENU. The match sim is frozen.
    if (session.match.phase === 'fulltime') {
      fullTimeTimer += dt;
      if (c.exit || fullTimeTimer >= FULLTIME_HOLD) {
        if (competition) enterCompResults();
        else enterPostMatch();
      } else {
        stepSession(session, dt); // keeps the ball settling + crowd alive
      }
      return;
    }

    if (c.exit) {
      session = null;
      screen = 'mainMenu';
      emitSfx('uiSelect');
      return;
    }
    if (c.pause) session.paused = !session.paused;
    if (c.restart) restartSession(session);
    if (c.toggleTwoPlayer && session.config.controlMode !== 'cpu') {
      session.config.controlMode = session.config.controlMode === '2p' ? '1p' : '2p';
      session.state.controlled2 = null;
    }
    stepSession(session, dt);
  }

  function updatePostMatch(): void {
    if (!session) {
      screen = 'mainMenu';
      return;
    }
    const m = consumeMenuInput();
    if (m.up && listMove(postMatch, -1)) emitSfx('uiMove');
    if (m.down && listMove(postMatch, 1)) emitSfx('uiMove');
    if (m.confirm) {
      emitSfx('uiSelect');
      if (postMatch.cursor === 0) {
        restartSession(session); // replay the same matchup
        clearActionEdges();
        fullTimeTimer = 0;
        screen = 'match';
      } else {
        session = null;
        screen = 'mainMenu';
      }
      return;
    }
    if (m.back) {
      emitSfx('uiSelect');
      session = null;
      screen = 'mainMenu';
    }
  }

  // --- competition flow -----------------------------------------------------

  // Record the player's result and simulate the rest of the round, then show
  // the results screen.
  function enterCompResults(): void {
    if (!competition || !session) {
      screen = 'mainMenu';
      return;
    }
    recordYourResult(competition, session.match.score[0], session.match.score[1]);
    simRound(competition);
    emitSfx('uiSelect');
    screen = 'compResults';
  }

  function updateCompHub(): void {
    if (!competition) {
      screen = 'mainMenu';
      return;
    }
    const m = consumeMenuInput();
    if (m.confirm) {
      emitSfx('uiSelect');
      playCompMatch();
      return;
    }
    if (m.back) {
      emitSfx('uiSelect');
      competition = null;
      session = null;
      screen = 'mainMenu';
    }
  }

  function updateCompResults(): void {
    if (!competition) {
      screen = 'mainMenu';
      return;
    }
    const m = consumeMenuInput();
    if (m.confirm || m.back) {
      emitSfx('uiSelect');
      advance(competition);
      session = null; // finished match no longer needed
      screen = competition.done ? 'compEnd' : 'compHub';
    }
  }

  function updateCompEnd(): void {
    const m = consumeMenuInput();
    if (m.confirm || m.back) {
      emitSfx('uiSelect');
      competition = null;
      session = null;
      screen = 'mainMenu';
    }
  }

  // --- drawing --------------------------------------------------------------

  function drawBackdrop(): void {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = BAND;
    ctx.fillRect(0, 0, VIEW_W, 40);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 40, VIEW_W, 2);
  }

  function drawSwatch(kit: Kit, x: number, y: number): void {
    const parts = [kit.shirt, kit.shorts, kit.socks];
    const s = 16;
    for (let i = 0; i < 3; i++) {
      const bx = x + i * (s + 5);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx - 1, y - 1, s + 2, s + 2);
      ctx.fillStyle = css(parts[i]);
      ctx.fillRect(bx, y, s, s);
    }
  }

  function drawTitle(): void {
    drawBackdrop();
    drawTextCentered(ctx, 'SENSI', 0, VIEW_W, 84, TITLE, 6);
    drawTextCentered(ctx, 'A SENSIBLE FOOTBALL REMAKE', 0, VIEW_W, 150, SUBTLE, 1);
    if (frames % 60 < 40) {
      drawTextCentered(ctx, 'PRESS SPACE', 0, VIEW_W, 186, DEFAULT_STYLE.hi, 2);
    }
  }

  function drawHeader(text: string): void {
    drawTextCentered(ctx, text, 0, VIEW_W, 14, TITLE, 2);
  }

  function drawMainMenu(): void {
    drawBackdrop();
    drawHeader('SENSI');
    drawList(ctx, mainMenu, VIEW_W / 2, 70, DEFAULT_STYLE);
    drawTextCentered(ctx, 'ARROWS MOVE   SPACE SELECT', 0, VIEW_W, VIEW_H - 16, SUBTLE, 1);
  }

  function drawFriendly(): void {
    drawBackdrop();
    drawHeader('FRIENDLY');
    drawList(ctx, friendly, VIEW_W / 2, 86, DEFAULT_STYLE);
    drawTextCentered(ctx, 'ESC BACK', 0, VIEW_W, VIEW_H - 16, SUBTLE, 1);
  }

  function drawTeamSelect(): void {
    drawBackdrop();
    const who =
      tsPurpose === 'competition'
        ? 'SELECT YOUR TEAM'
        : ts.picking === 'home'
          ? 'SELECT HOME TEAM'
          : 'SELECT AWAY TEAM';
    drawHeader(who);

    // Show the already-picked home team while choosing the away side.
    if (tsPurpose === 'friendly' && ts.picking === 'away' && ts.home) {
      drawTextCentered(ctx, `HOME: ${ts.home.name}`, 0, VIEW_W, 30, SUBTLE, 1);
    }

    if (ts.level === 'team') {
      // Compact rows + a scrolling window so the largest group (Europe, 18)
      // clears the kit preview below.
      drawList(ctx, ts.list, VIEW_W / 2, 58, TEAM_STYLE, 10);
      const team = teamsIn(CONTINENTS[ts.continent])[ts.list.cursor];
      if (team) {
        const sw = 3 * 16 + 2 * 5;
        drawSwatch(team.kit, Math.round((VIEW_W - sw) / 2), VIEW_H - 64);
        drawTextCentered(ctx, team.name, 0, VIEW_W, VIEW_H - 38, DEFAULT_STYLE.on, 1);
      }
    } else {
      drawList(ctx, ts.list, VIEW_W / 2, 78, DEFAULT_STYLE);
    }
    drawTextCentered(ctx, 'ESC BACK', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  // A mini own-half diagram: the team attacks upward, so the keeper sits at the
  // bottom (own goal) and forwards near the top. slot.y is depth into the own
  // half (0 = own goal line).
  function drawFormationDiagram(slots: Slot[], cx: number, topY: number, w: number, h: number): void {
    const left = Math.round(cx - w / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(left - 2, topY - 2, w + 4, h + 4);
    ctx.fillStyle = 'rgb(30,80,42)';
    ctx.fillRect(left, topY, w, h);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(left, topY, w, 1); // halfway line (top edge)
    for (const s of slots) {
      const px = Math.round(left + s.x * w);
      const py = Math.round(topY + h - s.y * h);
      ctx.fillStyle = ROLE_DOT[s.role];
      ctx.fillRect(px - 1, py - 1, 3, 3);
    }
  }

  function drawPreMatch(): void {
    drawBackdrop();
    const side = pm.queue[pm.index];
    const team = side === 0 ? ts.home : awayTeam;
    drawHeader(team ? team.name : 'FORMATION');
    drawTextCentered(ctx, side === 0 ? 'PLAYER 1' : 'PLAYER 2', 0, VIEW_W, 32, SUBTLE, 1);
    const id = FORMATION_IDS[pm.formIdx];
    drawTextCentered(ctx, `< ${FORMATION_NAMES[id]} >`, 0, VIEW_W, 50, DEFAULT_STYLE.hi, 2);
    drawFormationDiagram(FORMATIONS[id], VIEW_W / 2, 84, 96, 120);
    drawTextCentered(ctx, 'SPACE START   ESC BACK', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  function drawOptions(): void {
    drawBackdrop();
    drawHeader('OPTIONS');
    const rows = [
      { label: 'MATCH LENGTH', value: MATCH_LENGTHS[options.lengthIndex].label },
      { label: 'PITCH', value: PITCHES[options.pitchIndex].name },
    ];
    let y = 84;
    for (let i = 0; i < rows.length; i++) {
      const active = i === optCursor;
      drawTextCentered(ctx, rows[i].label, 0, VIEW_W, y, active ? DEFAULT_STYLE.hi : DEFAULT_STYLE.on, 2);
      drawTextCentered(ctx, `< ${rows[i].value} >`, 0, VIEW_W, y + 22, active ? DEFAULT_STYLE.hi : SUBTLE, 2);
      y += 64;
    }
    drawTextCentered(ctx, 'ARROWS CHANGE   ESC BACK', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  function drawPostMatch(): void {
    drawBackdrop();
    drawHeader('FULL TIME');
    if (session) {
      const { home, away } = session.config;
      const [hs, as] = session.match.score;
      drawTextCentered(ctx, `${home.short} ${hs} - ${as} ${away.short}`, 0, VIEW_W, 60, DEFAULT_STYLE.hi, 3);
      drawTextCentered(ctx, `${home.name}  V  ${away.name}`, 0, VIEW_W, 96, SUBTLE, 1);
    }
    drawList(ctx, postMatch, VIEW_W / 2, 150, DEFAULT_STYLE);
    drawTextCentered(ctx, 'SPACE SELECT   ESC MENU', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  // Small left-aligned text helper (scale 1).
  function text1(s: string, x: number, y: number, color: string): void {
    drawText(ctx, s, x, y, color, 1);
  }

  function drawLeagueTable(comp: Competition): void {
    const table = leagueTable(comp);
    const x = { pos: 10, team: 34, p: 200, gd: 236, pts: 286 };
    text1('P', x.p, 44, SUBTLE);
    text1('GD', x.gd, 44, SUBTLE);
    text1('PTS', x.pts, 44, SUBTLE);
    let y = 54;
    for (let i = 0; i < table.length; i++) {
      const r = table[i];
      const mine = r.team === comp.you;
      const c = mine ? DEFAULT_STYLE.hi : DEFAULT_STYLE.on;
      const gd = r.gf - r.ga;
      text1(`${i + 1}`, x.pos, y, c);
      text1(r.team.short, x.team, y, c);
      text1(`${r.p}`, x.p, y, c);
      text1(`${gd > 0 ? '+' : ''}${gd}`, x.gd, y, c);
      text1(`${r.pts}`, x.pts, y, c);
      y += 10;
    }
  }

  function drawCupRound(comp: Competition): void {
    const ties = comp.rounds[comp.roundIndex] ?? [];
    let y = 56;
    for (const f of ties) {
      const mine = f.a === comp.you || f.b === comp.you;
      const c = mine ? DEFAULT_STYLE.hi : DEFAULT_STYLE.on;
      const scoreShown = f.played;
      const mid = scoreShown ? `${f.sa} - ${f.sb}` : 'V';
      const line = `${f.a.short} ${mid} ${f.b.short}`;
      drawTextCentered(ctx, line, 0, VIEW_W, y, c, 2);
      y += 22;
    }
  }

  function drawCompHub(): void {
    if (!competition) return;
    drawBackdrop();
    const f = yourFixture(competition);
    if (competition.kind === 'league') {
      drawHeader('LEAGUE');
      drawTextCentered(ctx, `ROUND ${competition.roundIndex + 1} / ${competition.rounds.length}`, 0, VIEW_W, 28, SUBTLE, 1);
      drawLeagueTable(competition);
    } else {
      drawHeader('CUP');
      drawTextCentered(ctx, cupRoundName(competition), 0, VIEW_W, 28, SUBTLE, 1);
      drawCupRound(competition);
    }
    if (f) {
      const opp = f.a === competition.you ? f.b : f.a;
      drawTextCentered(ctx, `NEXT: ${competition.you.short} V ${opp.short}`, 0, VIEW_W, VIEW_H - 28, DEFAULT_STYLE.hi, 1);
    }
    drawTextCentered(ctx, 'SPACE PLAY   ESC QUIT', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  function drawCompResults(): void {
    if (!competition) return;
    drawBackdrop();
    const title =
      competition.kind === 'cup' ? `${cupRoundName(competition)} RESULTS` : `ROUND ${competition.roundIndex + 1} RESULTS`;
    drawHeader('RESULTS');
    drawTextCentered(ctx, title, 0, VIEW_W, 28, SUBTLE, 1);
    const round = competition.rounds[competition.roundIndex] ?? [];
    let y = 48;
    for (const f of round) {
      const mine = f.a === competition.you || f.b === competition.you;
      const c = mine ? DEFAULT_STYLE.hi : DEFAULT_STYLE.on;
      let line = `${f.a.short} ${f.sa} - ${f.sb} ${f.b.short}`;
      if (competition.kind === 'cup' && f.sa === f.sb && f.winner) line += ` (${f.winner.short} PENS)`;
      drawTextCentered(ctx, line, 0, VIEW_W, y, c, mine ? 2 : 1);
      y += mine ? 18 : 12;
    }
    drawTextCentered(ctx, 'SPACE CONTINUE', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  function drawCompEnd(): void {
    if (!competition) return;
    drawBackdrop();
    drawHeader('FULL TIME');
    const won = competition.champion === competition.you;
    if (competition.kind === 'cup') {
      if (won) {
        drawTextCentered(ctx, 'CUP WINNERS!', 0, VIEW_W, 80, DEFAULT_STYLE.hi, 3);
        drawTextCentered(ctx, competition.you.name, 0, VIEW_W, 120, DEFAULT_STYLE.on, 2);
      } else {
        drawTextCentered(ctx, 'KNOCKED OUT', 0, VIEW_W, 90, DEFAULT_STYLE.hi, 3);
      }
    } else {
      const champ = competition.champion;
      drawTextCentered(ctx, won ? 'CHAMPIONS!' : 'LEAGUE OVER', 0, VIEW_W, 80, DEFAULT_STYLE.hi, 3);
      if (champ) drawTextCentered(ctx, `WINNERS: ${champ.name}`, 0, VIEW_W, 124, DEFAULT_STYLE.on, 2);
    }
    drawTextCentered(ctx, 'SPACE MENU', 0, VIEW_W, VIEW_H - 14, SUBTLE, 1);
  }

  function drawMatch(alpha: number): void {
    if (!session) return;
    renderMatch(session, alpha);
    // Crowd swells as the ball nears either goal; spikes during the goal flash.
    const b = session.state.ball;
    const distToGoal = Math.min(Math.abs(b.y - FIELD_T), Math.abs(b.y - FIELD_B));
    const near = Math.max(0, 1 - distToGoal / 180);
    setCrowdIntensity(Math.max(near, session.match.flash > 0 ? 1 : 0));
  }

  // --- dispatch -------------------------------------------------------------

  return {
    update(dt: number): void {
      frames++;
      switch (screen) {
        case 'title':
          updateTitle();
          break;
        case 'mainMenu':
          updateMainMenu();
          break;
        case 'friendlySetup':
          updateFriendly();
          break;
        case 'teamSelect':
          updateTeamSelect();
          break;
        case 'preMatch':
          updatePreMatch();
          break;
        case 'options':
          updateOptions();
          break;
        case 'match':
          updateMatch(dt);
          break;
        case 'postMatch':
          updatePostMatch();
          break;
        case 'compHub':
          updateCompHub();
          break;
        case 'compResults':
          updateCompResults();
          break;
        case 'compEnd':
          updateCompEnd();
          break;
      }
    },
    draw(alpha: number): void {
      if (screen === 'match') {
        drawMatch(alpha);
        return;
      }
      setCrowdIntensity(0); // hush the crowd on menu screens
      switch (screen) {
        case 'title':
          drawTitle();
          break;
        case 'mainMenu':
          drawMainMenu();
          break;
        case 'friendlySetup':
          drawFriendly();
          break;
        case 'teamSelect':
          drawTeamSelect();
          break;
        case 'preMatch':
          drawPreMatch();
          break;
        case 'options':
          drawOptions();
          break;
        case 'postMatch':
          drawPostMatch();
          break;
        case 'compHub':
          drawCompHub();
          break;
        case 'compResults':
          drawCompResults();
          break;
        case 'compEnd':
          drawCompEnd();
          break;
      }
    },
  };
}
