// App shell: a small screen state machine above the match. Owns the menus
// (title -> main menu -> friendly setup -> team select) and the live match
// session. The fixed loop calls update(dt) then draw(alpha); each dispatches on
// the current screen. The match itself is unchanged — it just no longer boots
// at module load; a session is created on demand when a Friendly launches.

import { VIEW_W, VIEW_H, FIELD_T, FIELD_B } from './world';
import { drawTextCentered } from './sprites/font';
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
import { CONTINENTS, teamsIn, type TeamDef, type Kit } from './teams/data';
import { css } from './sprites/palette';

type AppScreen = 'title' | 'mainMenu' | 'friendlySetup' | 'teamSelect' | 'match';

const MAIN_ITEMS = ['FRIENDLY', 'CUP', 'LEAGUE', 'SPECIALS', 'OPTIONS', 'EDIT TEAMS'];
const MAIN_ENABLED = [true, false, false, false, false, false];

const FRIENDLY_ITEMS = ['1 PLAYER', '2 PLAYERS', 'CPU V CPU'];
const FRIENDLY_MODES: ControlMode[] = ['1p', '2p', 'cpu'];

interface TeamSelectState {
  picking: 'home' | 'away';
  level: 'continent' | 'team';
  continent: number; // index into CONTINENTS
  home: TeamDef | null;
  list: ListView;
}

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

  const mainMenu = makeList(MAIN_ITEMS, MAIN_ENABLED);
  const friendly = makeList(FRIENDLY_ITEMS);
  const ts: TeamSelectState = {
    picking: 'home',
    level: 'continent',
    continent: 0,
    home: null,
    list: makeList([...CONTINENTS]),
  };

  function nav(list: ListView, up: boolean, down: boolean): void {
    if (up && listMove(list, -1)) emitSfx('uiMove');
    if (down && listMove(list, 1)) emitSfx('uiMove');
  }

  function enterTeamSelect(): void {
    ts.picking = 'home';
    ts.level = 'continent';
    ts.home = null;
    ts.list = makeList([...CONTINENTS]);
    screen = 'teamSelect';
  }

  function launchMatch(home: TeamDef, away: TeamDef): void {
    session = makeSession({ home, away, controlMode: pendingMode });
    clearActionEdges(); // don't let the confirming keypress leak in as a kick
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
      if (mainMenu.items[mainMenu.cursor] === 'FRIENDLY') {
        friendly.cursor = 0;
        screen = 'friendlySetup';
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
        screen = 'friendlySetup';
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
    if (ts.picking === 'home') {
      ts.home = chosen;
      ts.picking = 'away';
      ts.level = 'continent';
      ts.list = makeList([...CONTINENTS]);
    } else if (ts.home) {
      launchMatch(ts.home, chosen);
    }
  }

  function updateMatch(dt: number): void {
    if (!session) return;
    const c = consumeMatchControls();
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
    const who = ts.picking === 'home' ? 'SELECT HOME TEAM' : 'SELECT AWAY TEAM';
    drawHeader(who);

    // Show the already-picked home team while choosing the away side.
    if (ts.picking === 'away' && ts.home) {
      drawTextCentered(ctx, `HOME: ${ts.home.name}`, 0, VIEW_W, 30, SUBTLE, 1);
    }

    if (ts.level === 'team') {
      // Compact rows so the tallest group (8 teams) clears the kit preview.
      drawList(ctx, ts.list, VIEW_W / 2, 50, TEAM_STYLE);
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
        case 'match':
          updateMatch(dt);
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
      }
    },
  };
}
