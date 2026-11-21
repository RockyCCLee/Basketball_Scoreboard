// Core Event-Sourced Stat Engine, Possession % Tracker, Game Flow Chart Renderer & Offline Recap Generator

window.createInitialMatchState = function(teamKey = 'B11_DD2') {
  const cfg = window.DUNKERS_CONFIG;
  const teams = window.DUNKERS_TEAMS || {};
  const teamProfile = teams[teamKey] || teams.B11_DD2 || {
    id: 'B11_DD2',
    teamName: cfg.teamName,
    folderPrefix: '2026Summer_B11_DD2_',
    roster: cfg.coreRoster
  };

  const today = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedDate = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

  const players = teamProfile.roster.map(p => ({
    ...p,
    isPlaying: p.defaultPlaying !== false,
    isStarter: Boolean(p.defaultStarter),
    onCourt: Boolean(p.defaultStarter),
    secondsPlayed: 0,
    manualMinOverride: null
  }));

  const starters = players.filter(p => p.isPlaying && p.isStarter).map(p => p.id);

  return {
    matchId: 'match_' + Date.now(),
    selectedTeamKey: teamProfile.id,
    folderPrefix: teamProfile.folderPrefix,
    teamName: teamProfile.teamName,
    teamLogo: cfg.teamLogoBase64,
    opponentName: 'Opponent Team',
    opponentLogo: cfg.defaultOpponentLogoBase64,
    gameDate: formattedDate,
    isHomeGame: false,
    seasonRecord: '',
    periodFormat: 'HALVES', // 'HALVES' (H1, H2)
    periodDurationSeconds: 20 * 60, // 20:00 default
    currentPeriod: 'H1',
    clockRemainingSeconds: 20 * 60,
    clockRunning: false,
    possessionMode: 'OFFENCE', // 'OFFENCE' | 'DEFENCE'
    possessionSeconds: {
      OFFENCE: 0,
      DEFENCE: 0,
      byPeriod: {
        H1: { OFFENCE: 0, DEFENCE: 0 },
        H2: { OFFENCE: 0, DEFENCE: 0 },
        OT: { OFFENCE: 0, DEFENCE: 0 }
      }
    },
    players: players,
    onCourtIds: starters.slice(0, 5),
    events: [], // Ordered event-sourced play-by-play list
    customRecapText: '',
    recapEditedManually: false,
    includeDnpInHtml: true
  };
};

window.formatStatPct = function(made, att) {
  if (!att || att <= 0) return '0.0';
  if (made === att) return '100';
  return ((made / att) * 100).toFixed(1);
};

window.formatPlayerMinDisplay = function(player) {
  if (player.manualMinOverride !== null && player.manualMinOverride !== undefined) {
    const m = Math.max(0, Number(player.manualMinOverride) || 0);
    return `${m}:00`;
  }
  const sec = Math.max(0, Math.floor(player.secondsPlayed || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

window.formatClockMMSS = function(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

window.createEmptyZoneMap = function() {
  const map = {};
  for (const z of window.COURT_ZONES) {
    map[z.id] = { made: 0, att: 0 };
  }
  return map;
};

/**
 * Deterministic Event-Sourced Calculation of Box Scores, Zone Stats, Period Scores, +/-, Possession %, and Game Flow
 */
window.computeMatchStats = function(state) {
  const playerStats = {};
  const teamZoneStats = window.createEmptyZoneMap();

  for (const p of state.players) {
    const computedMin = p.manualMinOverride !== null && p.manualMinOverride !== undefined
      ? Number(p.manualMinOverride)
      : Math.round((p.secondsPlayed || 0) / 60);

    playerStats[p.id] = {
      player: p,
      fg2Made: 0,
      fg2Att: 0,
      fg3Made: 0,
      fg3Att: 0,
      fgMade: 0,
      fgAtt: 0,
      ftMade: 0,
      ftAtt: 0,
      oreb: 0,
      dreb: 0,
      foul: 0,
      stl: 0,
      to: 0,
      blk: 0,
      asst: 0,
      plusMinus: 0,
      min: computedMin,
      pts: 0,
      hasAnyAction: false,
      zoneStats: window.createEmptyZoneMap()
    };
  }

  // Unassigned / Team-level bucket (when "Skip" is pressed on Step 1 Player Selection)
  const unassignedStats = {
    fg2Made: 0, fg2Att: 0,
    fg3Made: 0, fg3Att: 0,
    fgMade: 0, fgAtt: 0,
    ftMade: 0, ftAtt: 0,
    oreb: 0, dreb: 0, foul: 0, stl: 0, to: 0, blk: 0, asst: 0, pts: 0
  };

  const periods = ['H1', 'H2'];
  if (state.currentPeriod === 'OT' || state.events.some(e => e.period === 'OT')) {
    periods.push('OT');
  }

  const periodScores = {
    H1: { us: 0, opp: 0 },
    H2: { us: 0, opp: 0 },
    OT: { us: 0, opp: 0 }
  };

  let ourTotalPts = 0;
  let oppTotalPts = 0;

  // Game Flow points array
  // Each item: { team: 'US' | 'OPP', period: 'H1'|'H2'|'OT', clockRemaining: number, elapsedRatio: number, scoreAfter: number, ptsDelta: number, playerId: string|null }
  const gameFlowEvents = [];

  const periodDur = state.periodDurationSeconds || 1200;

  for (let idx = 0; idx < state.events.length; idx++) {
    const ev = state.events[idx];
    const per = ev.period || 'H1';
    if (!periodScores[per]) {
      periodScores[per] = { us: 0, opp: 0 };
    }

    const pStat = ev.playerId && playerStats[ev.playerId] ? playerStats[ev.playerId] : null;
    if (pStat) {
      pStat.hasAnyAction = true;
    }

    const target = pStat || unassignedStats;
    const onCourtList = Array.isArray(ev.onCourtIds) ? ev.onCourtIds : [];

    // Compute normalized x-coordinate in period [0..1]
    // Even if clock ran out (00:00), spread post-00:00 events smoothly near the end of the period
    const rem = typeof ev.clockRemaining === 'number' ? ev.clockRemaining : 0;
    const elapsedInPeriod = Math.max(0, Math.min(periodDur, periodDur - rem));
    const ratioInPeriod = periodDur > 0 ? elapsedInPeriod / periodDur : 0.5;

    switch (ev.actionType) {
      case '2PT_MADE': {
        target.fg2Made += 1;
        target.fg2Att += 1;
        target.fgMade += 1;
        target.fgAtt += 1;
        target.pts += 2;
        ourTotalPts += 2;
        periodScores[per].us += 2;

        if (ev.zoneId && teamZoneStats[ev.zoneId]) {
          teamZoneStats[ev.zoneId].made += 1;
          teamZoneStats[ev.zoneId].att += 1;
          if (pStat && pStat.zoneStats[ev.zoneId]) {
            pStat.zoneStats[ev.zoneId].made += 1;
            pStat.zoneStats[ev.zoneId].att += 1;
          }
        }

        if (ev.assistPlayerId && playerStats[ev.assistPlayerId]) {
          playerStats[ev.assistPlayerId].asst += 1;
          playerStats[ev.assistPlayerId].hasAnyAction = true;
        }

        for (const cid of onCourtList) {
          if (playerStats[cid]) playerStats[cid].plusMinus += 2;
        }

        gameFlowEvents.push({
          team: 'US',
          period: per,
          ratioInPeriod,
          scoreAfter: ourTotalPts,
          oppScoreAfter: oppTotalPts,
          ptsDelta: 2,
          playerId: ev.playerId || null,
          eventIndex: idx
        });
        break;
      }

      case '3PT_MADE': {
        target.fg3Made += 1;
        target.fg3Att += 1;
        target.fgMade += 1;
        target.fgAtt += 1;
        target.pts += 3;
        ourTotalPts += 3;
        periodScores[per].us += 3;

        if (ev.zoneId && teamZoneStats[ev.zoneId]) {
          teamZoneStats[ev.zoneId].made += 1;
          teamZoneStats[ev.zoneId].att += 1;
          if (pStat && pStat.zoneStats[ev.zoneId]) {
            pStat.zoneStats[ev.zoneId].made += 1;
            pStat.zoneStats[ev.zoneId].att += 1;
          }
        }

        if (ev.assistPlayerId && playerStats[ev.assistPlayerId]) {
          playerStats[ev.assistPlayerId].asst += 1;
          playerStats[ev.assistPlayerId].hasAnyAction = true;
        }

        for (const cid of onCourtList) {
          if (playerStats[cid]) playerStats[cid].plusMinus += 3;
        }

        gameFlowEvents.push({
          team: 'US',
          period: per,
          ratioInPeriod,
          scoreAfter: ourTotalPts,
          oppScoreAfter: oppTotalPts,
          ptsDelta: 3,
          playerId: ev.playerId || null,
          eventIndex: idx
        });
        break;
      }

      case '2PT_MISS': {
        target.fg2Att += 1;
        target.fgAtt += 1;
        if (ev.zoneId && teamZoneStats[ev.zoneId]) {
          teamZoneStats[ev.zoneId].att += 1;
          if (pStat && pStat.zoneStats[ev.zoneId]) {
            pStat.zoneStats[ev.zoneId].att += 1;
          }
        }
        break;
      }

      case '3PT_MISS': {
        target.fg3Att += 1;
        target.fgAtt += 1;
        if (ev.zoneId && teamZoneStats[ev.zoneId]) {
          teamZoneStats[ev.zoneId].att += 1;
          if (pStat && pStat.zoneStats[ev.zoneId]) {
            pStat.zoneStats[ev.zoneId].att += 1;
          }
        }
        break;
      }

      case 'FT_MADE': {
        target.ftMade += 1;
        target.ftAtt += 1;
        target.pts += 1;
        ourTotalPts += 1;
        periodScores[per].us += 1;

        for (const cid of onCourtList) {
          if (playerStats[cid]) playerStats[cid].plusMinus += 1;
        }

        gameFlowEvents.push({
          team: 'US',
          period: per,
          ratioInPeriod,
          scoreAfter: ourTotalPts,
          oppScoreAfter: oppTotalPts,
          ptsDelta: 1,
          playerId: ev.playerId || null,
          eventIndex: idx
        });
        break;
      }

      case 'FT_MISS': {
        target.ftAtt += 1;
        break;
      }

      case 'OREB': {
        target.oreb += 1;
        break;
      }

      case 'DREB': {
        target.dreb += 1;
        break;
      }

      case 'AST': {
        target.asst += 1;
        break;
      }

      case 'STL': {
        target.stl += 1;
        break;
      }

      case 'BLK': {
        target.blk += 1;
        break;
      }

      case 'TO': {
        target.to += 1;
        break;
      }

      case 'FOUL_OFF':
      case 'FOUL_DEF':
      case 'FOUL': {
        target.foul += 1;
        break;
      }

      case 'OPP_SCORE': {
        const delta = Number(ev.points) || 2;
        oppTotalPts = Math.max(0, oppTotalPts + delta);
        periodScores[per].opp = Math.max(0, periodScores[per].opp + delta);

        for (const cid of onCourtList) {
          if (playerStats[cid]) playerStats[cid].plusMinus -= delta;
        }

        if (delta > 0) {
          gameFlowEvents.push({
            team: 'OPP',
            period: per,
            ratioInPeriod,
            scoreAfter: oppTotalPts,
            usScoreAfter: ourTotalPts,
            ptsDelta: delta,
            playerId: null,
            eventIndex: idx
          });
        }
        break;
      }
    }
  }

  // Aggregate Our Team Totals
  const teamTotals = {
    fg2Made: unassignedStats.fg2Made,
    fg2Att: unassignedStats.fg2Att,
    fg3Made: unassignedStats.fg3Made,
    fg3Att: unassignedStats.fg3Att,
    fgMade: unassignedStats.fgMade,
    fgAtt: unassignedStats.fgAtt,
    ftMade: unassignedStats.ftMade,
    ftAtt: unassignedStats.ftAtt,
    oreb: unassignedStats.oreb,
    dreb: unassignedStats.dreb,
    foul: unassignedStats.foul,
    stl: unassignedStats.stl,
    to: unassignedStats.to,
    blk: unassignedStats.blk,
    asst: unassignedStats.asst,
    pts: ourTotalPts
  };

  const playerRows = Object.values(playerStats);
  for (const r of playerRows) {
    teamTotals.fg2Made += r.fg2Made;
    teamTotals.fg2Att += r.fg2Att;
    teamTotals.fg3Made += r.fg3Made;
    teamTotals.fg3Att += r.fg3Att;
    teamTotals.fgMade += r.fgMade;
    teamTotals.fgAtt += r.fgAtt;
    teamTotals.ftMade += r.ftMade;
    teamTotals.ftAtt += r.ftAtt;
    teamTotals.oreb += r.oreb;
    teamTotals.dreb += r.dreb;
    teamTotals.foul += r.foul;
    teamTotals.stl += r.stl;
    teamTotals.to += r.to;
    teamTotals.blk += r.blk;
    teamTotals.asst += r.asst;
  }

  // Sort players: Playing players first sorted by PTS desc, then MIN desc, then Jersey asc; DNP players at bottom
  const sortedPlayerRows = [...playerRows].sort((a, b) => {
    const aActive = a.player.isPlaying || a.hasAnyAction || a.min > 0;
    const bActive = b.player.isPlaying || b.hasAnyAction || b.min > 0;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.min !== a.min) return b.min - a.min;
    return Number(a.player.jersey) - Number(b.player.jersey);
  });

  // Possession % Calculation
  const offSec = (state.possessionSeconds && state.possessionSeconds.OFFENCE) || 0;
  const defSec = (state.possessionSeconds && state.possessionSeconds.DEFENCE) || 0;
  const totalPossSec = offSec + defSec;
  const offencePct = totalPossSec > 0 ? Math.round((offSec / totalPossSec) * 100) : 50;
  const defencePct = totalPossSec > 0 ? (100 - offencePct) : 50;

  const h1Poss = (state.possessionSeconds && state.possessionSeconds.byPeriod && state.possessionSeconds.byPeriod.H1) || { OFFENCE: 0, DEFENCE: 0 };
  const h2Poss = (state.possessionSeconds && state.possessionSeconds.byPeriod && state.possessionSeconds.byPeriod.H2) || { OFFENCE: 0, DEFENCE: 0 };
  const h1Tot = h1Poss.OFFENCE + h1Poss.DEFENCE;
  const h2Tot = h2Poss.OFFENCE + h2Poss.DEFENCE;

  return {
    playerStatsMap: playerStats,
    sortedPlayerRows,
    teamTotals,
    teamZoneStats,
    ourTotalPts,
    oppTotalPts,
    periods,
    periodScores,
    gameFlowEvents,
    possession: {
      offenceSeconds: offSec,
      defenceSeconds: defSec,
      totalSeconds: totalPossSec,
      offencePct,
      defencePct,
      h1OffencePct: h1Tot > 0 ? Math.round((h1Poss.OFFENCE / h1Tot) * 100) : null,
      h2OffencePct: h2Tot > 0 ? Math.round((h2Poss.OFFENCE / h2Tot) * 100) : null
    }
  };
};

/**
 * 100% Offline Rule-Based Sportswriter Game Recap Generator (Matches Reference HTML Files)
 */
window.generateOfflineRecap = function(state, computed) {
  const us = state.teamName || 'B11 Donvale Dunkers 2';
  const opp = state.opponentName || 'Opponent';
  const ourPts = computed.ourTotalPts;
  const oppPts = computed.oppTotalPts;
  const homeAwayWord = state.isHomeGame ? 'home' : 'away';
  const recordClause = state.seasonRecord ? ` to move their record to ${state.seasonRecord} on the season` : '';

  // Paragraph 1: Match Outcome
  let p1 = '';
  if (ourPts > oppPts) {
    const diff = ourPts - oppPts;
    const adj = diff >= 12 ? 'commanding' : (diff <= 5 ? 'thrilling, hard-fought' : 'strong');
    p1 = `The ${us} secured a ${adj} ${homeAwayWord} victory over ${opp}, prevailing ${ourPts}-${oppPts}${recordClause}. From the opening tip, the Dunkers showcased great teamwork, disciplined execution, and relentless energy on both ends of the floor.`;
  } else if (ourPts < oppPts) {
    const diff = oppPts - ourPts;
    const adj = diff <= 6 ? 'closely contested' : 'tough';
    p1 = `The ${us} battled hard in a ${adj} ${homeAwayWord} matchup against ${opp}, falling ${ourPts}-${oppPts}${recordClause}. Despite the final scoreline, the Dunkers showed plenty of heart and produced several standout individual performances to build on.`;
  } else {
    p1 = `The ${us} and ${opp} battled to a dramatic ${ourPts}-${oppPts} draw in an exciting ${homeAwayWord} contest${recordClause}, with both sides trading big plays right down to the final buzzer.`;
  }

  // Detect largest scoring run & first-half performers
  const h1Us = computed.periodScores.H1.us;
  const h1Opp = computed.periodScores.H1.opp;
  const h2Us = computed.periodScores.H2.us;
  const h2Opp = computed.periodScores.H2.opp;

  // Compute H1 player points
  const h1PlayerPts = {};
  for (const ev of state.events) {
    if ((ev.period || 'H1') === 'H1' && ev.playerId) {
      const pts = ev.actionType === '3PT_MADE' ? 3 : (ev.actionType === '2PT_MADE' ? 2 : (ev.actionType === 'FT_MADE' ? 1 : 0));
      if (pts > 0) {
        h1PlayerPts[ev.playerId] = (h1PlayerPts[ev.playerId] || 0) + pts;
      }
    }
  }
  const topH1Entry = Object.entries(h1PlayerPts).sort((a, b) => b[1] - a[1])[0];
  let topH1Text = '';
  if (topH1Entry && computed.playerStatsMap[topH1Entry[0]]) {
    const p = computed.playerStatsMap[topH1Entry[0]].player;
    topH1Text = ` ${p.fullName} (#${p.jersey}) led the first-half charge with ${topH1Entry[1]} points.`;
  }

  // Paragraph 2: First Half Flow
  let p2 = '';
  if (h1Us > h1Opp) {
    p2 = `The Dunkers came out firing in the first half, taking a ${h1Us}-${h1Opp} lead into the break.${topH1Text} Strong ball movement and active hands on defence allowed ${us} to set the early tempo.`;
  } else if (h1Us < h1Opp) {
    p2 = `The first half was a competitive battle as ${opp} built a ${h1Opp}-${h1Us} advantage heading into halftime.${topH1Text} The Dunkers stayed composed and continued creating quality looks inside and on the perimeter.`;
  } else {
    p2 = `Neither side gave an inch in an evenly matched first half, heading into the break locked at ${h1Us}-${h1Opp}.${topH1Text}`;
  }

  // Paragraph 3: Second Half, Top Scorers, Efficiency & Possession %
  const activeScorers = computed.sortedPlayerRows.filter(r => r.pts > 0);
  let performerSentences = [];

  if (activeScorers.length > 0) {
    const leader = activeScorers[0];
    const leaderPct = leader.fgAtt > 0 ? Math.round((leader.fgMade / leader.fgAtt) * 100) : 0;
    const pctText = leader.fgAtt >= 2 && leaderPct >= 50 ? ` on an efficient ${leaderPct}% (${leader.fgMade}-${leader.fgAtt}) from the field` : '';
    const rebTotal = leader.oreb + leader.dreb;
    const extraLeader = rebTotal >= 3 ? ` while pulling down ${rebTotal} rebounds` : (leader.asst >= 2 ? ` and dishing out ${leader.asst} assists` : '');
    performerSentences.push(`${leader.player.fullName} (#${leader.player.jersey}) paced the Dunkers with a team-high ${leader.pts} points${pctText}${extraLeader}.`);
  }

  if (activeScorers.length > 1) {
    const second = activeScorers[1];
    const secondPct = second.fgAtt > 0 ? Math.round((second.fgMade / second.fgAtt) * 100) : 0;
    const pctText = second.fgAtt >= 2 && secondPct >= 50 ? ` (${secondPct}% FG)` : '';
    performerSentences.push(`${second.player.fullName} (#${second.player.jersey}) was also impressive, contributing ${second.pts} points${pctText}.`);
  }

  if (activeScorers.length > 2) {
    const others = activeScorers.slice(2, 5).map(r => `${r.player.fullName} (#${r.player.jersey}, ${r.pts} pts)`);
    performerSentences.push(`Additional scoring punch came from ${others.join(', ')}.`);
  }

  // Hustle & Possession highlights
  const topRebounder = [...computed.sortedPlayerRows].sort((a, b) => (b.oreb + b.dreb) - (a.oreb + a.dreb))[0];
  if (topRebounder && (topRebounder.oreb + topRebounder.dreb) >= 4 && (!activeScorers[0] || topRebounder.player.id !== activeScorers[0].player.id)) {
    performerSentences.push(`${topRebounder.player.fullName} anchored the glass with ${topRebounder.oreb + topRebounder.dreb} rebounds (${topRebounder.oreb} offensive, ${topRebounder.dreb} defensive).`);
  }

  const possClause = computed.possession.totalSeconds > 0
    ? ` Overall, ${us} controlled ${computed.possession.offencePct}% of the tracked possession time.`
    : '';

  const h2Intro = h2Us >= h2Opp
    ? `In the second half, the Dunkers outscored ${opp} ${h2Us}-${h2Opp} with determined two-way play.`
    : `In the second half, the Dunkers added ${h2Us} points and kept competing until the final whistle.`;

  const p3 = `${h2Intro} ${performerSentences.join(' ')}${possClause} Great effort by the entire ${us} squad!`;

  return `${p1}\n\n${p2}\n\n${p3}`;
};

/**
 * Renders the Easy Stats-style Cumulative Game Flow Line Chart onto an HTML5 Canvas
 * and returns a Base64 JPEG Data URI.
 */
window.renderGameFlowCanvas = function(canvas, state, computed) {
  if (!canvas) return '';
  const width = 800;
  const height = 430;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const usName = state.teamName || 'B11 Donvale Dunkers 2';
  const oppName = state.opponentName || 'Opponent';

  // Top Team Legend (Green for Our Team, Red for Opponent, matching Easy Stats flow img)
  ctx.font = '500 19px "Droid Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0fa868';
  ctx.fillText(usName, 16, 28);
  const usTextWidth = ctx.measureText(usName).width;

  ctx.fillStyle = '#d44432';
  ctx.fillText(oppName, 16 + usTextWidth + 18, 28);

  // Chart plot bounds
  const leftPad = 18;
  const rightPad = 18;
  const topPad = 64;
  const bottomPad = 16;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;

  const maxScoreRaw = Math.max(computed.ourTotalPts, computed.oppTotalPts, 20);
  const yMax = Math.ceil((maxScoreRaw + 5) / 10) * 10;

  // Axes & Period Vertical Dividers
  const numPeriods = computed.periods.length; // usually 2 ('H1', 'H2')
  const periodW = plotW / numPeriods;

  // Left vertical Y-axis & Bottom horizontal X-axis
  ctx.strokeStyle = '#1b1464';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(leftPad, topPad);
  ctx.lineTo(leftPad, topPad + plotH);
  ctx.lineTo(leftPad + plotW, topPad + plotH);
  ctx.stroke();

  // Y-axis tick labels (10, 20, 30, 40, 50...)
  ctx.fillStyle = '#1b1464';
  ctx.font = '700 13px "Droid Sans", sans-serif';
  ctx.textAlign = 'left';
  for (let yVal = 10; yVal <= yMax; yVal += 10) {
    const yPos = topPad + plotH - (yVal / yMax) * plotH;
    ctx.fillText(String(yVal), leftPad + 6, yPos + 12);
  }

  // Period vertical lines & 'H1', 'H2' headers at top of dividers
  ctx.textAlign = 'center';
  ctx.font = '700 14px "Droid Sans", sans-serif';
  for (let i = 0; i < numPeriods; i++) {
    const pLabel = computed.periods[i];
    const xLine = leftPad + (i + 1) * periodW;
    ctx.strokeStyle = '#5c588a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xLine, topPad);
    ctx.lineTo(xLine, topPad + plotH);
    ctx.stroke();

    ctx.fillStyle = '#1b1464';
    ctx.fillText(pLabel, xLine, topPad - 8);
  }

  // Build coordinate points for US and OPP
  // Group events by period so even post-00:00 plays distribute cleanly inside their period
  const usPoints = [{ x: leftPad, y: topPad + plotH }];
  const oppPoints = [{ x: leftPad, y: topPad + plotH }];

  for (let pIdx = 0; pIdx < numPeriods; pIdx++) {
    const pName = computed.periods[pIdx];
    const pStartX = leftPad + pIdx * periodW;
    const pEvents = computed.gameFlowEvents.filter(e => e.period === pName);

    const totalInPer = pEvents.length;
    pEvents.forEach((ev, idxInPer) => {
      // Combine clock ratio with sequence ratio so events never overlap on identical x
      const seqRatio = totalInPer > 0 ? (idxInPer + 1) / (totalInPer + 0.5) : 0.5;
      const blendedRatio = Math.min(0.99, Math.max(0.03, ev.ratioInPeriod * 0.55 + seqRatio * 0.45));
      const px = pStartX + blendedRatio * periodW;
      const py = topPad + plotH - (ev.scoreAfter / yMax) * plotH;

      if (ev.team === 'US') {
        usPoints.push({ x: px, y: py });
      } else {
        oppPoints.push({ x: px, y: py });
      }
    });
  }

  // Helper to draw line + circular data markers
  function drawSeries(pts, color) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    ctx.fillStyle = color;
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSeries(oppPoints, '#d44432');
  drawSeries(usPoints, '#0fa868');

  return canvas.toDataURL('image/jpeg', 0.92);
};
