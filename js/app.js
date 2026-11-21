// Main Application Controller for B11 Donvale Dunkers 2 Basketball Scoreboard

(function() {
  const STORAGE_KEY = 'b11_dunkers_2_current_match_v1';

  let matchState = loadSavedState() || window.createInitialMatchState();
  let activeTab = 'SCORING'; // 'SCORING' | 'STATS' | 'ROSTER'
  let activeStatsSubTab = 'BOX_SCORE'; // 'BOX_SCORE' | 'SHOT_CHART' | 'GAME_FLOW'
  let shotChartPlayerFilter = 'ALL'; // 'ALL' or player.id

  // Guided Action Flow Wizard State
  // steps: 'SELECT_PLAYER' -> 'SELECT_ZONE' -> 'SELECT_ASSIST'
  let wizard = null;

  // Edit Historical Play Modal State
  let editingEventId = null;
  let editDraft = null;

  // Recently removed event for 5-second Restore toast
  let lastRemovedEvent = null;
  let restoreToastTimer = null;

  // Live 1-second interval timer for Countdown Clock, Player Minutes & Offence/Defence Possession %
  let clockInterval = null;
  let zoneAdvanceTimeout = null;

  function loadSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.events)) {
          parsed.clockRunning = false; // Always start paused on page reload
          if (!parsed.selectedTeamKey) {
            parsed.selectedTeamKey = 'B11_DD2';
            parsed.teamName = 'B11 Dunker 2';
            parsed.folderPrefix = '2026Summer_B11_DD2_';
          }
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not load saved state:', e);
    }
    return null;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(matchState));
    } catch (e) {
      console.warn('Could not save state to localStorage:', e);
    }
  }

  // Start 1-second ticker
  function ensureClockLoop() {
    if (clockInterval) return;
    clockInterval = setInterval(() => {
      if (!matchState.clockRunning) return;

      // 1. Decrement game countdown clock (stops at 00:00, never blocks scoring!)
      if (matchState.clockRemainingSeconds > 0) {
        matchState.clockRemainingSeconds = Math.max(0, matchState.clockRemainingSeconds - 1);
      }

      // 2. Increment playing time (secondsPlayed) for the 5 players currently On the Court
      const onCourtSet = new Set(matchState.onCourtIds || []);
      for (const p of matchState.players) {
        if (onCourtSet.has(p.id)) {
          p.secondsPlayed = (p.secondsPlayed || 0) + 1;
        }
      }

      // 3. Increment Possession time based on OFFENCE / DEFENCE toggle
      const mode = matchState.possessionMode === 'DEFENCE' ? 'DEFENCE' : 'OFFENCE';
      if (!matchState.possessionSeconds) {
        matchState.possessionSeconds = {
          OFFENCE: 0,
          DEFENCE: 0,
          byPeriod: { H1: { OFFENCE: 0, DEFENCE: 0 }, H2: { OFFENCE: 0, DEFENCE: 0 }, OT: { OFFENCE: 0, DEFENCE: 0 } }
        };
      }
      matchState.possessionSeconds[mode] = (matchState.possessionSeconds[mode] || 0) + 1;
      const per = matchState.currentPeriod || 'H1';
      if (!matchState.possessionSeconds.byPeriod[per]) {
        matchState.possessionSeconds.byPeriod[per] = { OFFENCE: 0, DEFENCE: 0 };
      }
      matchState.possessionSeconds.byPeriod[per][mode] = (matchState.possessionSeconds.byPeriod[per][mode] || 0) + 1;

      saveState();
      updateLiveClockAndPossessionDOM();
    }, 1000);
  }

  function updateLiveClockAndPossessionDOM() {
    const clockEl = document.getElementById('live-clock-display');
    if (clockEl) {
      clockEl.textContent = window.formatClockMMSS(matchState.clockRemainingSeconds);
      clockEl.classList.toggle('clock-zero', matchState.clockRemainingSeconds === 0);
    }

    // Update On-Court player minute badges
    for (const p of matchState.players) {
      const minEl = document.getElementById(`oncourt-min-${p.id}`);
      if (minEl) {
        const m = p.manualMinOverride !== null && p.manualMinOverride !== undefined
          ? p.manualMinOverride
          : Math.round((p.secondsPlayed || 0) / 60);
        minEl.textContent = `${m}m`;
      }
    }

    // Update Offence / Defence Possession % badges
    const offSec = (matchState.possessionSeconds && matchState.possessionSeconds.OFFENCE) || 0;
    const defSec = (matchState.possessionSeconds && matchState.possessionSeconds.DEFENCE) || 0;
    const tot = offSec + defSec;
    const offPct = tot > 0 ? Math.round((offSec / tot) * 100) : 50;
    const defPct = tot > 0 ? (100 - offPct) : 50;

    const offBadge = document.getElementById('toggle-offence-sub');
    const defBadge = document.getElementById('toggle-defence-sub');
    if (offBadge) offBadge.textContent = `${offPct}% • ${window.formatClockMMSS(offSec)}`;
    if (defBadge) defBadge.textContent = `${defPct}% • ${window.formatClockMMSS(defSec)}`;
  }

  // Action metadata helpers
  const ACTION_META = {
    '2PT_MADE': { label: '+2 PT FG Made', short: '+2 PT FG', mode: 'OFFENCE', hasZone: true, shotType: 2, hasAssist: true },
    '3PT_MADE': { label: '+3 PT FG Made', short: '+3 PT FG', mode: 'OFFENCE', hasZone: true, shotType: 3, hasAssist: true },
    '2PT_MISS': { label: '2PT Missed', short: '2PT Miss', mode: 'OFFENCE', hasZone: true, shotType: 2, hasAssist: false },
    '3PT_MISS': { label: '3PT Missed', short: '3PT Miss', mode: 'OFFENCE', hasZone: true, shotType: 3, hasAssist: false },
    'FT_MADE':  { label: '+1 Free Throw Made', short: '+1 FT Made', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'FT_MISS':  { label: 'Free Throw Missed', short: 'FT Miss', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'OREB':     { label: 'Offensive Rebound', short: 'OREB', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'AST':      { label: 'Assist', short: 'AST', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'TO':       { label: 'Turnover', short: 'TO', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'FOUL_OFF': { label: 'Offensive Foul', short: 'Foul (Off)', mode: 'OFFENCE', hasZone: false, hasAssist: false },
    'DREB':     { label: 'Defensive Rebound', short: 'DREB', mode: 'DEFENCE', hasZone: false, hasAssist: false },
    'STL':      { label: 'Steal', short: 'STL', mode: 'DEFENCE', hasZone: false, hasAssist: false },
    'BLK':      { label: 'Block', short: 'BLK', mode: 'DEFENCE', hasZone: false, hasAssist: false },
    'FOUL_DEF': { label: 'Defensive Foul', short: 'Foul (Def)', mode: 'DEFENCE', hasZone: false, hasAssist: false }
  };

  window.getPlayerById = function(pid) {
    return matchState.players.find(p => p.id === pid) || null;
  };

  window.formatPlayEventDescription = function(ev) {
    if (ev.actionType === 'OPP_SCORE') {
      const sign = ev.points > 0 ? `+${ev.points}` : `${ev.points}`;
      return `${matchState.opponentName} ${sign} PTS`;
    }
    const meta = ACTION_META[ev.actionType] || { label: ev.actionType };
    const p = ev.playerId ? window.getPlayerById(ev.playerId) : null;
    const pText = p ? p.displayName : '⚠️ [Unassigned Player]';
    const zone = ev.zoneId ? window.getZoneById(ev.zoneId) : null;
    const zoneText = zone ? ` • 📍 ${zone.shortLabel}` : (meta.hasZone ? ' • 📍 [No Zone]' : '');
    let assistText = '';
    if (ev.assistPlayerId) {
      const ap = window.getPlayerById(ev.assistPlayerId);
      if (ap) assistText = ` (AST: ${ap.displayName})`;
    }
    return `${pText} — ${meta.label}${zoneText}${assistText}`;
  };

  // ============================================================================
  // CLOCK & PERIOD CONTROLS (Allows scoring even after clock reaches 00:00)
  // ============================================================================
  window.toggleClockRunning = function() {
    matchState.clockRunning = !matchState.clockRunning;
    saveState();
    renderApp();
  };

  window.changePeriod = function(newPeriod) {
    if (matchState.currentPeriod === newPeriod) return;
    matchState.clockRunning = false;
    matchState.currentPeriod = newPeriod;
    matchState.clockRemainingSeconds = matchState.periodDurationSeconds || 1200;
    saveState();
    renderApp();
  };

  window.openClockAdjustModal = function() {
    matchState.clockRunning = false;
    saveState();
    const modal = document.getElementById('clock-adjust-modal');
    if (modal) {
      modal.classList.remove('hidden');
      renderClockAdjustModal();
    }
  };

  window.closeClockAdjustModal = function() {
    const modal = document.getElementById('clock-adjust-modal');
    if (modal) modal.classList.add('hidden');
    renderApp();
  };

  window.adjustClockBySeconds = function(deltaSec) {
    const maxSec = 60 * 60;
    matchState.clockRemainingSeconds = Math.max(0, Math.min(maxSec, matchState.clockRemainingSeconds + deltaSec));
    saveState();
    renderClockAdjustModal();
    updateLiveClockAndPossessionDOM();
  };

  window.applyManualClockInput = function() {
    const minIn = document.getElementById('manual-clock-min');
    const secIn = document.getElementById('manual-clock-sec');
    if (!minIn || !secIn) return;
    const m = Math.max(0, parseInt(minIn.value, 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(secIn.value, 10) || 0));
    matchState.clockRemainingSeconds = m * 60 + s;
    saveState();
    window.closeClockAdjustModal();
  };

  function renderClockAdjustModal() {
    const container = document.getElementById('clock-adjust-body');
    if (!container) return;
    const m = Math.floor(matchState.clockRemainingSeconds / 60);
    const s = matchState.clockRemainingSeconds % 60;
    container.innerHTML = `
      <div class="clock-adjust-display">${window.formatClockMMSS(matchState.clockRemainingSeconds)} <span>(${matchState.currentPeriod} • Paused)</span></div>
      <div class="clock-step-row">
        <button class="btn-step" onclick="window.adjustClockBySeconds(-60)">-1m</button>
        <button class="btn-step" onclick="window.adjustClockBySeconds(-10)">-10s</button>
        <button class="btn-step" onclick="window.adjustClockBySeconds(-1)">-1s</button>
        <button class="btn-step" onclick="window.adjustClockBySeconds(1)">+1s</button>
        <button class="btn-step" onclick="window.adjustClockBySeconds(10)">+10s</button>
        <button class="btn-step" onclick="window.adjustClockBySeconds(60)">+1m</button>
      </div>
      <div class="clock-direct-row">
        <label>Set Exact MM:SS</label>
        <div class="clock-inputs">
          <input type="number" id="manual-clock-min" min="0" max="60" value="${m}" />
          <span>:</span>
          <input type="number" id="manual-clock-sec" min="0" max="59" value="${String(s).padStart(2, '0')}" />
          <button class="btn-primary-sm" onclick="window.applyManualClockInput()">Set</button>
        </div>
      </div>
      <div class="clock-modal-actions">
        <button class="btn-secondary" onclick="window.adjustClockBySeconds(${(matchState.periodDurationSeconds || 1200) - matchState.clockRemainingSeconds})">Reset to ${window.formatClockMMSS(matchState.periodDurationSeconds || 1200)}</button>
        <button class="btn-success" onclick="window.closeClockAdjustModal(); window.toggleClockRunning();">▶ Resume Clock</button>
      </div>
    `;
  }

  // ============================================================================
  // OFFENCE / DEFENCE TOGGLE & OPPONENT QUICK SCORE
  // ============================================================================
  window.setPossessionMode = function(mode) {
    matchState.possessionMode = mode === 'DEFENCE' ? 'DEFENCE' : 'OFFENCE';
    saveState();
    renderApp();
  };

  window.addOpponentQuickScore = function(ptsDelta) {
    const ev = {
      id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      period: matchState.currentPeriod || 'H1',
      clockRemaining: matchState.clockRemainingSeconds,
      actionType: 'OPP_SCORE',
      points: ptsDelta,
      playerId: null,
      zoneId: null,
      assistPlayerId: null,
      onCourtIds: [...(matchState.onCourtIds || [])]
    };
    matchState.events.push(ev);
    saveState();
    renderApp();
  };

  // ============================================================================
  // GUIDED STEP-BY-STEP ACTION FLOW WIZARD (With "← Return" & "Skip →" on Every Step)
  // ============================================================================
  window.startActionFlow = function(actionType) {
    if (zoneAdvanceTimeout) {
      clearTimeout(zoneAdvanceTimeout);
      zoneAdvanceTimeout = null;
    }
    const meta = ACTION_META[actionType];
    if (!meta) return;

    wizard = {
      actionType,
      meta,
      step: 'SELECT_PLAYER', // Step 1 is ALWAYS Select Player
      playerId: null,
      zoneId: null,
      assistPlayerId: null
    };
    renderWizardModal();
  };

  window.wizardReturn = function() {
    if (!wizard) return;
    if (zoneAdvanceTimeout) {
      clearTimeout(zoneAdvanceTimeout);
      zoneAdvanceTimeout = null;
    }
    if (wizard.step === 'SELECT_PLAYER') {
      // Return from Step 1 -> Cancel wizard back to pad
      wizard = null;
      renderWizardModal();
    } else if (wizard.step === 'SELECT_ZONE') {
      // Return from Step 2 -> Back to Step 1 (Select Player)
      wizard.step = 'SELECT_PLAYER';
      renderWizardModal();
    } else if (wizard.step === 'SELECT_ASSIST') {
      // Return from Step 3 -> Back to Step 2 (Select Zone)
      wizard.step = 'SELECT_ZONE';
      renderWizardModal();
    }
  };

  window.wizardSkip = function() {
    if (!wizard) return;
    if (zoneAdvanceTimeout) {
      clearTimeout(zoneAdvanceTimeout);
      zoneAdvanceTimeout = null;
    }
    if (wizard.step === 'SELECT_PLAYER') {
      wizard.playerId = null; // Unassigned player
      advanceAfterPlayerStep();
    } else if (wizard.step === 'SELECT_ZONE') {
      wizard.zoneId = null; // Unassigned zone
      advanceAfterZoneStep();
    } else if (wizard.step === 'SELECT_ASSIST') {
      wizard.assistPlayerId = null; // No assist
      commitWizardEvent();
    }
  };

  window.wizardSelectPlayer = function(playerId) {
    if (!wizard) return;
    wizard.playerId = playerId;
    advanceAfterPlayerStep();
  };

  function advanceAfterPlayerStep() {
    if (!wizard) return;
    if (wizard.meta.hasZone) {
      wizard.step = 'SELECT_ZONE';
      renderWizardModal();
    } else {
      commitWizardEvent();
    }
  }

  // Called when user clicks an active 2PT or 3PT zone on the Half-Court Map
  window.handleCourtZoneClick = function(zoneId) {
    // Check if we are in the live wizard OR in the Edit Play modal
    if (wizard && wizard.step === 'SELECT_ZONE') {
      wizard.zoneId = zoneId;
      // Re-render immediately so the user sees the glowing selection effect, ripple ring & "✓ Selected" badge!
      renderWizardModal();
      if (zoneAdvanceTimeout) clearTimeout(zoneAdvanceTimeout);
      zoneAdvanceTimeout = setTimeout(() => {
        zoneAdvanceTimeout = null;
        advanceAfterZoneStep();
      }, 360);
      return;
    }

    if (editingEventId && editDraft) {
      editDraft.zoneId = zoneId;
      renderEditPlayModal();
    }
  };

  window.wizardConfirmZoneNow = function() {
    if (zoneAdvanceTimeout) {
      clearTimeout(zoneAdvanceTimeout);
      zoneAdvanceTimeout = null;
    }
    advanceAfterZoneStep();
  };

  function advanceAfterZoneStep() {
    if (!wizard) return;
    if (wizard.meta.hasAssist) {
      wizard.step = 'SELECT_ASSIST';
      renderWizardModal();
    } else {
      commitWizardEvent();
    }
  }

  window.wizardSelectAssist = function(assistPlayerId) {
    if (!wizard) return;
    wizard.assistPlayerId = assistPlayerId || null;
    commitWizardEvent();
  };

  function commitWizardEvent() {
    if (!wizard) return;
    const ev = {
      id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      period: matchState.currentPeriod || 'H1',
      clockRemaining: matchState.clockRemainingSeconds,
      actionType: wizard.actionType,
      playerId: wizard.playerId || null,
      zoneId: wizard.zoneId || null,
      assistPlayerId: wizard.assistPlayerId || null,
      onCourtIds: [...(matchState.onCourtIds || [])]
    };
    matchState.events.push(ev);
    wizard = null;
    saveState();
    renderWizardModal();
    renderApp();
  }

  function renderWizardModal() {
    const modal = document.getElementById('action-wizard-modal');
    if (!modal) return;
    if (!wizard) {
      modal.classList.add('hidden');
      modal.innerHTML = '';
      return;
    }
    modal.classList.remove('hidden');

    const activePlayers = matchState.players.filter(p => p.isPlaying);
    const onCourtSet = new Set(matchState.onCourtIds || []);
    const onCourtPlayers = activePlayers.filter(p => onCourtSet.has(p.id));
    const benchPlayers = activePlayers.filter(p => !onCourtSet.has(p.id));

    const totalSteps = wizard.meta.hasAssist ? 3 : (wizard.meta.hasZone ? 2 : 1);
    const currentStepNum = wizard.step === 'SELECT_PLAYER' ? 1 : (wizard.step === 'SELECT_ZONE' ? 2 : 3);

    const navBarHtml = `
      <div class="wizard-nav-bar">
        <button class="btn-wizard-nav btn-return" onclick="window.wizardReturn()">
          ← Return ${currentStepNum === 1 ? '(Cancel)' : ''}
        </button>
        <span class="wizard-step-pill">Step ${currentStepNum} of ${totalSteps}</span>
        <button class="btn-wizard-nav btn-skip" onclick="window.wizardSkip()">
          Skip →
        </button>
      </div>
    `;

    let bodyHtml = '';

    if (wizard.step === 'SELECT_PLAYER') {
      const onCourtCards = onCourtPlayers.map(p => `
        <button class="player-select-card on-court-card" onclick="window.wizardSelectPlayer('${p.id}')">
          <span class="p-jersey">#${p.jersey}</span>
          <span class="p-name">${p.shortName}</span>
          <span class="p-tag">On Court</span>
        </button>
      `).join('');

      const benchCards = benchPlayers.map(p => `
        <button class="player-select-card bench-card" onclick="window.wizardSelectPlayer('${p.id}')">
          <span class="p-jersey">#${p.jersey}</span>
          <span class="p-name">${p.shortName}</span>
          <span class="p-tag">${p.isCore ? 'Bench' : 'Fill-In'}</span>
        </button>
      `).join('');

      bodyHtml = `
        <div class="wizard-title-block">
          <h3>${wizard.meta.label} — Select Player</h3>
          <p>Tap the player who took this action</p>
        </div>
        <div class="wizard-section-label">On the Court (${onCourtPlayers.length})</div>
        <div class="player-select-grid">${onCourtCards || '<div class="empty-note">No players on court</div>'}</div>
        ${benchPlayers.length > 0 ? `
          <div class="wizard-section-label">Bench / Fill-In (${benchPlayers.length})</div>
          <div class="player-select-grid bench-grid">${benchCards}</div>
        ` : ''}
      `;
    } else if (wizard.step === 'SELECT_ZONE') {
      const shooter = wizard.playerId ? window.getPlayerById(wizard.playerId) : null;
      const shooterLabel = shooter ? shooter.displayName : 'Unassigned Player';
      const is3Pt = wizard.meta.shotType === 3;
      const modeTitle = is3Pt ? '3PT Mode: Only 3-Point zones are active (2PT zones locked 🔒)' : '2PT Mode: Only 2-Point zones are active (3PT zones locked 🔒)';
      const selectedZone = wizard.zoneId ? window.getZoneById(wizard.zoneId) : null;

      bodyHtml = `
        <div class="wizard-title-block">
          <h3>Select ${is3Pt ? '3PT' : '2PT'} Shot Zone — ${shooterLabel}</h3>
          <p class="zone-lock-subtitle">${modeTitle}</p>
        </div>
        <div class="court-zone-picker-container">
          ${window.buildZoneSelectorSVG(wizard.meta.shotType, wizard.zoneId)}
        </div>
        <div class="zone-selection-status-bar">
          ${selectedZone
            ? `<div class="zone-selected-pill">✓ Selected: <strong>${selectedZone.name}</strong></div>
               <button class="btn-confirm-zone" onclick="window.wizardConfirmZoneNow()">Continue →</button>`
            : `<div class="zone-unselected-hint">Tap an active ${is3Pt ? '3-Point' : '2-Point'} zone on the court above</div>`
          }
        </div>
      `;
    } else if (wizard.step === 'SELECT_ASSIST') {
      const shooter = wizard.playerId ? window.getPlayerById(wizard.playerId) : null;
      const shooterLabel = shooter ? shooter.displayName : 'Unassigned Player';
      const zone = wizard.zoneId ? window.getZoneById(wizard.zoneId) : null;
      const zoneBadge = zone ? `from ${zone.shortLabel}` : '';

      const eligibleOnCourt = onCourtPlayers.filter(p => p.id !== wizard.playerId);
      const eligibleBench = benchPlayers.filter(p => p.id !== wizard.playerId);

      const onCourtAssistCards = eligibleOnCourt.map(p => `
        <button class="player-select-card on-court-card" onclick="window.wizardSelectAssist('${p.id}')">
          <span class="p-jersey">#${p.jersey}</span>
          <span class="p-name">${p.shortName}</span>
          <span class="p-tag">Assist</span>
        </button>
      `).join('');

      const benchAssistCards = eligibleBench.map(p => `
        <button class="player-select-card bench-card" onclick="window.wizardSelectAssist('${p.id}')">
          <span class="p-jersey">#${p.jersey}</span>
          <span class="p-name">${p.shortName}</span>
          <span class="p-tag">Assist</span>
        </button>
      `).join('');

      bodyHtml = `
        <div class="wizard-title-block">
          <h3>Who Did the Assist?</h3>
          <p>${shooterLabel} scored ${wizard.meta.short} ${zoneBadge}</p>
        </div>
        <button class="btn-no-assist" onclick="window.wizardSelectAssist(null)">
          🚫 No One / Unassisted
        </button>
        <div class="wizard-section-label">Teammates On the Court</div>
        <div class="player-select-grid">${onCourtAssistCards}</div>
        ${eligibleBench.length > 0 ? `
          <div class="wizard-section-label">Bench / Fill-In</div>
          <div class="player-select-grid bench-grid">${benchAssistCards}</div>
        ` : ''}
      `;
    }

    modal.innerHTML = `
      <div class="modal-card wizard-modal-card">
        ${navBarHtml}
        <div class="wizard-body">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  // ============================================================================
  // SUBSTITUTION MODAL ("On the Court 5")
  // ============================================================================
  window.openSubModal = function() {
    const modal = document.getElementById('sub-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderSubModal();
  };

  window.closeSubModal = function() {
    const modal = document.getElementById('sub-modal');
    if (modal) modal.classList.add('hidden');
    renderApp();
  };

  window.togglePlayerOnCourt = function(playerId) {
    const idx = matchState.onCourtIds.indexOf(playerId);
    if (idx !== -1) {
      matchState.onCourtIds.splice(idx, 1);
    } else {
      if (matchState.onCourtIds.length >= 5) {
        alert('Already 5 players on the court. Tap an on-court player first to sub them out.');
        return;
      }
      matchState.onCourtIds.push(playerId);
    }
    const p = window.getPlayerById(playerId);
    if (p) p.onCourt = matchState.onCourtIds.includes(playerId);
    saveState();
    renderSubModal();
  };

  function renderSubModal() {
    const modal = document.getElementById('sub-modal');
    if (!modal) return;
    const activePlayers = matchState.players.filter(p => p.isPlaying);
    const onCourtSet = new Set(matchState.onCourtIds || []);

    const rowsHtml = activePlayers.map(p => {
      const isOn = onCourtSet.has(p.id);
      const mins = Math.round((p.secondsPlayed || 0) / 60);
      return `
        <div class="sub-player-row ${isOn ? 'sub-on-court' : 'sub-on-bench'}" onclick="window.togglePlayerOnCourt('${p.id}')">
          <div class="sub-p-info">
            <span class="sub-jersey">#${p.jersey}</span>
            <span class="sub-name">${p.shortName}</span>
            <span class="sub-mins">(${mins} min played)</span>
          </div>
          <button class="btn-sub-toggle ${isOn ? 'on' : 'off'}">
            ${isOn ? '✓ ON COURT' : '+ SUB IN'}
          </button>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3>Substitutions — On the Court (${matchState.onCourtIds.length}/5)</h3>
          <button class="btn-close-x" onclick="window.closeSubModal()">✕</button>
        </div>
        <p class="modal-hint">Tap an On-Court player to sub them out, then tap a Bench player to sub them in.</p>
        <div class="sub-list">${rowsHtml}</div>
        <div class="modal-footer">
          <button class="btn-primary-full" onclick="window.closeSubModal()">Done (${matchState.onCourtIds.length}/5 On Court)</button>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // PLAY-BY-PLAY EDITOR: (1) MODIFY PLAYER / ZONE & (2) REMOVE ACTION
  // ============================================================================
  window.undoLastAction = function() {
    if (matchState.events.length === 0) return;
    const removed = matchState.events.pop();
    showRestoreToast(removed, matchState.events.length);
    saveState();
    renderApp();
  };

  window.removePlayEventById = function(eventId) {
    const idx = matchState.events.findIndex(e => e.id === eventId);
    if (idx === -1) return;
    const [removed] = matchState.events.splice(idx, 1);
    if (editingEventId === eventId) {
      window.closeEditPlayModal();
    }
    showRestoreToast(removed, idx);
    saveState();
    renderApp();
  };

  function showRestoreToast(removedEvent, index) {
    lastRemovedEvent = { event: removedEvent, index };
    if (restoreToastTimer) clearTimeout(restoreToastTimer);
    const toast = document.getElementById('undo-toast');
    if (toast) {
      toast.classList.remove('hidden');
      toast.innerHTML = `
        <span>Removed: <strong>${window.formatPlayEventDescription(removedEvent)}</strong></span>
        <button class="btn-toast-restore" onclick="window.restoreLastRemovedEvent()">Restore</button>
      `;
    }
    restoreToastTimer = setTimeout(() => {
      lastRemovedEvent = null;
      if (toast) toast.classList.add('hidden');
    }, 6000);
  }

  window.restoreLastRemovedEvent = function() {
    if (!lastRemovedEvent) return;
    const { event, index } = lastRemovedEvent;
    const insertAt = Math.min(matchState.events.length, Math.max(0, index));
    matchState.events.splice(insertAt, 0, event);
    lastRemovedEvent = null;
    if (restoreToastTimer) clearTimeout(restoreToastTimer);
    const toast = document.getElementById('undo-toast');
    if (toast) toast.classList.add('hidden');
    saveState();
    renderApp();
  };

  window.openEditPlayModal = function(eventId) {
    const ev = matchState.events.find(e => e.id === eventId);
    if (!ev) return;
    editingEventId = eventId;
    editDraft = {
      playerId: ev.playerId || null,
      zoneId: ev.zoneId || null,
      assistPlayerId: ev.assistPlayerId || null
    };
    const modal = document.getElementById('edit-play-modal');
    if (modal) {
      modal.classList.remove('hidden');
      renderEditPlayModal();
    }
  };

  window.closeEditPlayModal = function() {
    editingEventId = null;
    editDraft = null;
    const modal = document.getElementById('edit-play-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.innerHTML = '';
    }
  };

  window.editDraftSelectPlayer = function(playerId) {
    if (!editDraft) return;
    editDraft.playerId = playerId || null;
    if (editDraft.assistPlayerId === playerId) {
      editDraft.assistPlayerId = null;
    }
    renderEditPlayModal();
  };

  window.editDraftSelectAssist = function(assistPlayerId) {
    if (!editDraft) return;
    editDraft.assistPlayerId = assistPlayerId || null;
    renderEditPlayModal();
  };

  window.saveEditedPlayEvent = function() {
    if (!editingEventId || !editDraft) return;
    const ev = matchState.events.find(e => e.id === editingEventId);
    if (ev) {
      ev.playerId = editDraft.playerId || null;
      ev.zoneId = editDraft.zoneId || null;
      ev.assistPlayerId = editDraft.assistPlayerId || null;
      saveState();
    }
    window.closeEditPlayModal();
    renderApp();
  };

  function renderEditPlayModal() {
    const modal = document.getElementById('edit-play-modal');
    if (!modal || !editingEventId || !editDraft) return;
    const ev = matchState.events.find(e => e.id === editingEventId);
    if (!ev) return;
    const meta = ACTION_META[ev.actionType] || { label: ev.actionType, hasZone: false, hasAssist: false };

    const playerButtons = matchState.players.map(p => {
      const isSelected = editDraft.playerId === p.id;
      return `
        <button class="chip-select ${isSelected ? 'chip-selected' : ''}" onclick="window.editDraftSelectPlayer('${p.id}')">
          ${isSelected ? '✓ ' : ''}${p.displayName}
        </button>
      `;
    }).join('');

    let zoneSectionHtml = '';
    if (meta.hasZone) {
      const selZone = editDraft.zoneId ? window.getZoneById(editDraft.zoneId) : null;
      zoneSectionHtml = `
        <div class="edit-section">
          <div class="edit-section-header">
            <label>Shot Zone (${meta.shotType}PT Areas Only)</label>
            ${selZone ? `<span class="zone-selected-inline">✓ ${selZone.name}</span>` : `<span class="zone-unassigned-inline">No zone selected</span>`}
          </div>
          <div class="court-zone-picker-container edit-court-container">
            ${window.buildZoneSelectorSVG(meta.shotType, editDraft.zoneId)}
          </div>
        </div>
      `;
    }

    let assistSectionHtml = '';
    if (meta.hasAssist) {
      const assistBtns = matchState.players
        .filter(p => p.id !== editDraft.playerId)
        .map(p => {
          const isSel = editDraft.assistPlayerId === p.id;
          return `
            <button class="chip-select ${isSel ? 'chip-selected' : ''}" onclick="window.editDraftSelectAssist('${p.id}')">
              ${isSel ? '✓ ' : ''}${p.displayName}
            </button>
          `;
        }).join('');

      assistSectionHtml = `
        <div class="edit-section">
          <label>Assist By</label>
          <div class="chip-grid">
            <button class="chip-select ${!editDraft.assistPlayerId ? 'chip-selected' : ''}" onclick="window.editDraftSelectAssist(null)">
              ${!editDraft.assistPlayerId ? '✓ ' : ''}No One
            </button>
            ${assistBtns}
          </div>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="modal-card edit-play-modal-card">
        <div class="modal-header">
          <h3>Edit Play — ${meta.label} (${ev.period} ${window.formatClockMMSS(ev.clockRemaining)})</h3>
          <button class="btn-close-x" onclick="window.closeEditPlayModal()">✕</button>
        </div>
        <div class="edit-play-body">
          <div class="edit-section">
            <label>1. Modify Player Who Took Action</label>
            <div class="chip-grid">${playerButtons}</div>
          </div>
          ${zoneSectionHtml}
          ${assistSectionHtml}
        </div>
        <div class="edit-play-footer">
          <button class="btn-danger-outline" onclick="window.removePlayEventById('${ev.id}')">🗑️ Remove Action</button>
          <div class="edit-footer-right">
            <button class="btn-secondary" onclick="window.closeEditPlayModal()">Cancel</button>
            <button class="btn-success" onclick="window.saveEditedPlayEvent()">✓ Save Changes</button>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================================
  // PRE-GAME ROSTER & ONE-OFF FILL-IN PLAYER FUNCTIONS
  // ============================================================================
  window.togglePlayerPlaying = function(playerId) {
    const p = window.getPlayerById(playerId);
    if (!p) return;
    p.isPlaying = !p.isPlaying;
    if (!p.isPlaying) {
      p.isStarter = false;
      p.onCourt = false;
      matchState.onCourtIds = matchState.onCourtIds.filter(id => id !== playerId);
    }
    saveState();
    renderApp();
  };

  window.togglePlayerStarter = function(playerId) {
    const p = window.getPlayerById(playerId);
    if (!p || !p.isPlaying) return;

    if (p.isStarter) {
      p.isStarter = false;
      p.onCourt = false;
      matchState.onCourtIds = matchState.onCourtIds.filter(id => id !== playerId);
    } else {
      const currentStarters = matchState.players.filter(pl => pl.isPlaying && pl.isStarter);
      if (currentStarters.length >= 5) {
        alert('You already have 5 Starters selected. Tap an existing Starter badge first to switch them to Bench.');
        return;
      }
      p.isStarter = true;
      p.onCourt = true;
      if (!matchState.onCourtIds.includes(playerId)) {
        matchState.onCourtIds.push(playerId);
      }
    }
    saveState();
    renderApp();
  };

  window.addFillInPlayer = function() {
    const jerseyEl = document.getElementById('fillin-jersey');
    const firstEl = document.getElementById('fillin-firstname');
    const lastEl = document.getElementById('fillin-lastname');
    if (!jerseyEl || !firstEl) return;

    const jersey = jerseyEl.value.trim();
    const firstName = firstEl.value.trim();
    const lastName = (lastEl ? lastEl.value.trim() : '') || '';

    if (!jersey || !firstName) {
      alert('Please enter a Jersey # and First Name for the fill-in player.');
      return;
    }

    const lastInitial = lastName ? ` ${lastName.charAt(0).toUpperCase()}.` : '';
    const shortName = `${firstName}${lastInitial}`;
    const displayName = `#${jersey} ${shortName}`;
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;

    const newPlayer = {
      id: 'fillin_' + Date.now(),
      jersey,
      firstName,
      lastName,
      shortName,
      displayName,
      fullName,
      isCore: false,
      isPlaying: true,
      isStarter: matchState.onCourtIds.length < 5,
      onCourt: matchState.onCourtIds.length < 5,
      secondsPlayed: 0,
      manualMinOverride: null
    };

    matchState.players.push(newPlayer);
    if (newPlayer.onCourt) {
      matchState.onCourtIds.push(newPlayer.id);
    }

    jerseyEl.value = '';
    firstEl.value = '';
    if (lastEl) lastEl.value = '';

    saveState();
    renderApp();
  };

  window.removeFillInPlayer = function(playerId) {
    const p = window.getPlayerById(playerId);
    if (!p || p.isCore) return;
    matchState.players = matchState.players.filter(pl => pl.id !== playerId);
    matchState.onCourtIds = matchState.onCourtIds.filter(id => id !== playerId);
    saveState();
    renderApp();
  };

  window.updateMatchSetupField = function(field, value) {
    if (field === 'periodDurationMinutes') {
      const mins = Math.max(1, Math.min(60, parseInt(value, 10) || 20));
      matchState.periodDurationSeconds = mins * 60;
      if (matchState.events.length === 0) {
        matchState.clockRemainingSeconds = mins * 60;
      }
    } else {
      matchState[field] = value;
    }
    saveState();
    renderApp();
  };

  window.handleOpponentLogoUpload = function(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      if (e.target && e.target.result) {
        matchState.opponentLogo = e.target.result;
        saveState();
        renderApp();
      }
    };
    reader.readAsDataURL(file);
  };

  function applyTeamRosterToState(teamKey) {
    const teams = window.DUNKERS_TEAMS || {};
    const profile = teams[teamKey];
    if (!profile) return;

    matchState.selectedTeamKey = profile.id;
    matchState.teamName = profile.teamName;
    matchState.folderPrefix = profile.folderPrefix;
    matchState.players = (profile.roster || []).map(p => ({
      ...p,
      isPlaying: p.defaultPlaying !== false,
      isStarter: Boolean(p.defaultStarter),
      onCourt: Boolean(p.defaultStarter),
      secondsPlayed: 0,
      manualMinOverride: null
    }));
    matchState.onCourtIds = matchState.players
      .filter(p => p.isPlaying && p.isStarter)
      .map(p => p.id)
      .slice(0, 5);
    shotChartPlayerFilter = 'ALL';
    saveState();
    renderApp();
  }

  window.selectTeamProfile = async function(teamKey) {
    const teams = window.DUNKERS_TEAMS || {};
    let profile = teams[teamKey];
    if (!profile) return;

    if (matchState.selectedTeamKey === teamKey && matchState.players.length > 0) {
      return;
    }

    if (matchState.events.length > 0) {
      if (!confirm(`Switch team to "${profile.teamName}"? This will load ${profile.teamName}'s roster and clear the current match plays.`)) {
        return;
      }
      matchState.events = [];
    }

    // If roster has not been loaded from Google Drive yet, fetch ONCE from folder 1-GSovenRouWVnOw-L9kbSbrT061SLLT9
    if (!profile.roster || profile.roster.length === 0) {
      try {
        await window.fetchTeamsAndRostersFromGoogleDrive();
      } catch (e) {
        console.warn('Roster fetch notice:', e.message);
      }
    }

    applyTeamRosterToState(teamKey);
  };

  window.syncRostersFromGoogleDriveOnce = async function(silent = false) {
    const btn = document.getElementById('btn-sync-roster');
    const origText = btn ? btn.textContent : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Loading Roster from Google Drive...';
      }
      const res = await window.fetchTeamsAndRostersFromGoogleDrive();
      const currentTeamKey = matchState.selectedTeamKey || 'B11_DD2';
      // Only overwrite active match players if game hasn't started or roster was empty
      if (matchState.events.length === 0 || matchState.players.length === 0) {
        applyTeamRosterToState(currentTeamKey);
      } else {
        renderApp();
      }
      if (!silent) {
        const srcLabel = res.source === 'LOCAL_FILE' ? 'Local teams_rosters.json' : 'Google Drive (1-GSovenRouWVnOw-L9kbSbrT061SLLT9)';
        alert(`✅ Loaded Teams & Players from ${srcLabel}!\nNo more Google connections needed during live scoring.`);
      }
    } catch (err) {
      if (!silent) {
        if (err && err.message === 'NEEDS_CONFIG') {
          window.openDriveSettingsModal();
        } else {
          alert('Could not load roster from Google Drive: ' + (err.message || err));
        }
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText || '☁️ Load Roster from Google Drive';
      }
    }
  };

  window.importRosterJSONFile = function(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const payload = JSON.parse(e.target.result);
        window.cacheTeamsAndRostersLocally(payload);
        const currentTeamKey = matchState.selectedTeamKey || payload.defaultTeamKey || 'B11_DD2';
        applyTeamRosterToState(currentTeamKey);
        alert('✅ Loaded teams_rosters.json and cached locally!');
      } catch (err) {
        alert('Invalid teams_rosters.json file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  window.resetNewMatch = function() {
    if (!confirm(`Start a new match for ${matchState.teamName}? This will clear current match plays and reset the clock.`)) {
      return;
    }
    const currentTeamKey = matchState.selectedTeamKey || 'B11_DD2';
    matchState = window.createInitialMatchState(currentTeamKey);
    saveState();
    activeTab = 'ROSTER';
    renderApp();
  };

  // ============================================================================
  // STATS TAB, MANUAL MIN EDIT, HTML EXPORT & GOOGLE DRIVE SAVE
  // ============================================================================
  window.switchTab = function(tabName) {
    activeTab = tabName;
    renderApp();
  };

  window.switchStatsSubTab = function(subTab) {
    activeStatsSubTab = subTab;
    renderApp();
  };

  window.setShotChartPlayerFilter = function(val) {
    shotChartPlayerFilter = val;
    renderApp();
  };

  window.promptEditPlayerMin = function(playerId) {
    const p = window.getPlayerById(playerId);
    if (!p) return;
    const currentMin = p.manualMinOverride !== null && p.manualMinOverride !== undefined
      ? p.manualMinOverride
      : Math.round((p.secondsPlayed || 0) / 60);
    const input = prompt(`Adjust minutes played (min) for ${p.displayName}:`, String(currentMin));
    if (input === null) return;
    const parsed = parseInt(input.trim(), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      p.manualMinOverride = parsed;
      p.secondsPlayed = parsed * 60;
      saveState();
      renderApp();
    }
  };

  window.handleRecapTextareaInput = function(el) {
    matchState.customRecapText = el.value;
    matchState.recapEditedManually = true;
    saveState();
  };

  window.regenerateRecapFromStats = function() {
    const computed = window.computeMatchStats(matchState);
    matchState.customRecapText = window.generateOfflineRecap(matchState, computed);
    matchState.recapEditedManually = false;
    saveState();
    renderApp();
  };

  function buildFullExportHTMLString() {
    const computed = window.computeMatchStats(matchState);
    const tempCanvas = document.createElement('canvas');
    const flowImgDataUrl = window.renderGameFlowCanvas(tempCanvas, matchState, computed);
    return window.generateEasyStatsHTML(matchState, computed, flowImgDataUrl);
  }

  window.downloadEasyStatsHTML = function() {
    const htmlStr = buildFullExportHTMLString();
    const filename = window.getExportHtmlFilename(matchState);
    const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.downloadMatchJSON = function() {
    const ts = window.getTimestampYYYYMMDDHHMMSS();
    const filename = `${window.buildSubfolderName(matchState, ts)}.json`;
    const blob = new Blob([JSON.stringify(matchState, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.importMatchJSONFile = function(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const loaded = JSON.parse(e.target.result);
        if (loaded && Array.isArray(loaded.players) && Array.isArray(loaded.events)) {
          loaded.clockRunning = false;
          matchState = loaded;
          saveState();
          renderApp();
          alert(`Loaded match: ${matchState.teamName} vs ${matchState.opponentName}`);
        } else {
          alert('Invalid match JSON file format.');
        }
      } catch (err) {
        alert('Error parsing JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  window.triggerSaveToGoogleDrive = async function() {
    const btn = document.getElementById('btn-save-gdrive');
    const origText = btn ? btn.textContent : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Creating _yyyymmddhhmmss Folder & Saving...';
      }
      const htmlStr = buildFullExportHTMLString();
      const res = await window.saveMatchToGoogleDrive(matchState, htmlStr);
      alert(`✅ Saved to Google Drive!\n\nCreated Subfolder:\n${res.subfolderName}\n\nParent Folder: 14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1`);
    } catch (err) {
      if (err && err.message === 'NEEDS_CONFIG') {
        window.openDriveSettingsModal();
      } else {
        alert('Google Drive Save Error: ' + (err.message || err));
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText || '☁️ Save to Google Drive (_yyyymmddhhmmss)';
      }
    }
  };

  window.openDriveSettingsModal = function() {
    const modal = document.getElementById('drive-settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const s = window.getDriveSettings();
    const previewSubfolder = window.buildSubfolderName(matchState);
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3>☁️ Google Drive Connection Setup</h3>
          <button class="btn-close-x" onclick="window.closeDriveSettingsModal()">✕</button>
        </div>
        <div class="drive-settings-body">
          <div class="drive-folder-banner">
            <div><strong>1. Private Roster Folder (Read Once at Start):</strong><br/>
              <a href="${window.DUNKERS_CONFIG.rosterDriveFolderUrl}" target="_blank" rel="noopener">1-GSovenRouWVnOw-L9kbSbrT061SLLT9 ↗</a> (<code>teams_rosters.json</code>)
            </div>
            <div style="margin-top:8px;"><strong>2. Match Results Folder (Saved Once After Game):</strong><br/>
              <a href="${window.DUNKERS_CONFIG.googleDriveFolderUrl}" target="_blank" rel="noopener">14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1 ↗</a>
            </div>
            <div class="drive-subfolder-preview">Subfolder created on save: <code>${previewSubfolder}</code></div>
          </div>

          <div class="form-group">
            <label>Recommended: Google Apps Script Web App URL</label>
            <input type="url" id="gdrive-script-url" placeholder="https://script.google.com/macros/s/.../exec" value="${window.escapeHtml(s.appsScriptUrl || '')}" />
            <small>Deploy <code>google-drive-bridge/Code.gs</code> at <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> to both read <code>teams_rosters.json</code> and save match results with zero OAuth token expiration.</small>
          </div>

          <div class="form-group">
            <label>Optional Secret Key (if set in Code.gs)</label>
            <input type="password" id="gdrive-secret-key" placeholder="Optional secret password" value="${window.escapeHtml(s.secretKey || '')}" />
          </div>

          <div class="form-group">
            <label>Alternative: Google Cloud API Key (for reading public/link-shared roster) or OAuth Token</label>
            <input type="password" id="gdrive-api-key" placeholder="AIzaSy... (Google API Key)" value="${window.escapeHtml(s.googleApiKey || '')}" style="margin-bottom:6px;" />
            <input type="password" id="gdrive-oauth-token" placeholder="ya29.a0... (OAuth 2.0 Bearer Token)" value="${window.escapeHtml(s.oauthAccessToken || '')}" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="window.closeDriveSettingsModal()">Cancel</button>
          <button class="btn-success" onclick="window.saveDriveSettingsFromModal()">Save &amp; Sync Roster</button>
        </div>
      </div>
    `;
  };

  window.closeDriveSettingsModal = function() {
    const modal = document.getElementById('drive-settings-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.saveDriveSettingsFromModal = async function() {
    const urlEl = document.getElementById('gdrive-script-url');
    const secEl = document.getElementById('gdrive-secret-key');
    const apiEl = document.getElementById('gdrive-api-key');
    const tokEl = document.getElementById('gdrive-oauth-token');
    window.saveDriveSettings({
      appsScriptUrl: urlEl ? urlEl.value.trim() : '',
      secretKey: secEl ? secEl.value.trim() : '',
      googleApiKey: apiEl ? apiEl.value.trim() : '',
      oauthAccessToken: tokEl ? tokEl.value.trim() : ''
    });
    window.closeDriveSettingsModal();
    await window.syncRostersFromGoogleDriveOnce(false);
  };

  // ============================================================================
  // MAIN RENDER FUNCTION
  // ============================================================================
  function renderApp() {
    ensureClockLoop();
    const computed = window.computeMatchStats(matchState);
    const root = document.getElementById('app-root');
    if (!root) return;

    const isOffence = matchState.possessionMode !== 'DEFENCE';
    const poss = computed.possession;

    // Top Header (Clock, Pause/Resume, Adjust, Period selector & Scoreboard Banner)
    const headerHtml = `
      <header class="top-app-header">
        <div class="top-clock-bar">
          <div class="period-select-wrap">
            <select class="period-select" onchange="window.changePeriod(this.value)">
              <option value="H1" ${matchState.currentPeriod === 'H1' ? 'selected' : ''}>H1 (Half 1)</option>
              <option value="H2" ${matchState.currentPeriod === 'H2' ? 'selected' : ''}>H2 (Half 2)</option>
              <option value="OT" ${matchState.currentPeriod === 'OT' ? 'selected' : ''}>OT</option>
            </select>
          </div>

          <div class="clock-center-group">
            <div id="live-clock-display" class="live-clock-digits ${matchState.clockRemainingSeconds === 0 ? 'clock-zero' : ''}"
                 onclick="window.openClockAdjustModal()" title="Tap to adjust clock">
              ${window.formatClockMMSS(matchState.clockRemainingSeconds)}
            </div>
            <button class="btn-clock-toggle ${matchState.clockRunning ? 'running' : 'paused'}"
                    onclick="window.toggleClockRunning()">
              ${matchState.clockRunning ? '⏸ Pause' : '▶ Start'}
            </button>
            <button class="btn-clock-adjust" onclick="window.openClockAdjustModal()" title="Adjust Clock (+/-)">
              ⚙️ +/-
            </button>
          </div>

          <div class="top-quick-export">
            <button class="btn-top-save" onclick="window.triggerSaveToGoogleDrive()" title="Save to Google Drive (_yyyymmddhhmmss)">
              ☁️ Save
            </button>
          </div>
        </div>

        ${matchState.clockRemainingSeconds === 0 ? `
          <div class="post-buzzer-banner">
            ⏰ Clock at 00:00 (${matchState.currentPeriod}) — Scoring & play input remains active! Switch period when ready.
          </div>
        ` : ''}

        <div class="scoreboard-card">
          <div class="sb-team sb-us">
            <img class="sb-logo" src="${matchState.teamLogo}" alt="Dunkers" />
            <div class="sb-team-meta">
              <div class="sb-team-name">${window.escapeHtml(matchState.teamName)}</div>
              <div class="sb-period-pills">
                <span>H1: ${computed.periodScores.H1.us}</span>
                <span>H2: ${computed.periodScores.H2.us}</span>
              </div>
            </div>
            <div class="sb-score">${computed.ourTotalPts}</div>
          </div>

          <div class="sb-divider">VS</div>

          <div class="sb-team sb-opp">
            <div class="sb-score">${computed.oppTotalPts}</div>
            <div class="sb-team-meta sb-opp-meta">
              <div class="sb-team-name">${window.escapeHtml(matchState.opponentName)}</div>
              <div class="opp-quick-score-btns">
                <button onclick="window.addOpponentQuickScore(1)" title="Opponent +1">+1</button>
                <button onclick="window.addOpponentQuickScore(2)" title="Opponent +2">+2</button>
                <button onclick="window.addOpponentQuickScore(3)" title="Opponent +3">+3</button>
                <button class="opp-minus" onclick="window.addOpponentQuickScore(-1)" title="Opponent -1">-1</button>
              </div>
            </div>
            <img class="sb-logo" src="${matchState.opponentLogo}" alt="Opponent" />
          </div>
        </div>

        <nav class="main-tabs-nav">
          <button class="tab-btn ${activeTab === 'SCORING' ? 'active' : ''}" onclick="window.switchTab('SCORING')">
            🏀 Scoring
          </button>
          <button class="tab-btn ${activeTab === 'STATS' ? 'active' : ''}" onclick="window.switchTab('STATS')">
            📊 Stats & Export
          </button>
          <button class="tab-btn ${activeTab === 'ROSTER' ? 'active' : ''}" onclick="window.switchTab('ROSTER')">
            👥 Roster & Setup
          </button>
        </nav>
      </header>
    `;

    let mainContentHtml = '';

    if (activeTab === 'SCORING') {
      mainContentHtml = renderScoringTab(computed, isOffence, poss);
    } else if (activeTab === 'STATS') {
      mainContentHtml = renderStatsTab(computed);
    } else {
      mainContentHtml = renderRosterSetupTab();
    }

    root.innerHTML = headerHtml + `<main class="app-main-content">${mainContentHtml}</main>`;

    // If on STATS -> GAME_FLOW sub-tab, draw the live Game Flow Canvas
    if (activeTab === 'STATS' && activeStatsSubTab === 'GAME_FLOW') {
      const canvas = document.getElementById('live-gameflow-canvas');
      if (canvas) {
        window.renderGameFlowCanvas(canvas, matchState, computed);
      }
    }
  }

  function renderScoringTab(computed, isOffence, poss) {
    // 1. Offence / Defence Toggle Bar with live Possession %
    const toggleHtml = `
      <div class="possession-toggle-container">
        <button class="poss-toggle-btn poss-offence ${isOffence ? 'active' : ''}"
                onclick="window.setPossessionMode('OFFENCE')">
          <div class="poss-title">🏀 OFFENCE</div>
          <div id="toggle-offence-sub" class="poss-sub">${poss.offencePct}% • ${window.formatClockMMSS(poss.offenceSeconds)}</div>
        </button>
        <button class="poss-toggle-btn poss-defence ${!isOffence ? 'active' : ''}"
                onclick="window.setPossessionMode('DEFENCE')">
          <div class="poss-title">🛡️ DEFENCE</div>
          <div id="toggle-defence-sub" class="poss-sub">${poss.defencePct}% • ${window.formatClockMMSS(poss.defenceSeconds)}</div>
        </button>
      </div>
    `;

    // 2. Context-sensitive Action Pad (Offence-only buttons OR Defence-only buttons)
    let actionPadHtml = '';
    if (isOffence) {
      actionPadHtml = `
        <div class="action-pad offence-pad">
          <div class="pad-col">
            <button class="act-btn btn-make-2pt" onclick="window.startActionFlow('2PT_MADE')">
              <span class="act-big">+2</span>
              <span class="act-sub">PT FG</span>
            </button>
            <button class="act-btn btn-miss-2pt" onclick="window.startActionFlow('2PT_MISS')">
              <span class="act-big">2PT</span>
              <span class="act-sub">Miss</span>
            </button>
          </div>

          <div class="pad-col pad-center-col">
            <div class="ft-row">
              <button class="act-btn btn-ft-make" onclick="window.startActionFlow('FT_MADE')">+1 FT Made</button>
              <button class="act-btn btn-ft-miss" onclick="window.startActionFlow('FT_MISS')">FT Miss</button>
            </div>
            <div class="minor-stat-grid">
              <button class="act-btn btn-stat-white" onclick="window.startActionFlow('OREB')">OREB</button>
              <button class="act-btn btn-stat-white" onclick="window.startActionFlow('AST')">AST</button>
              <button class="act-btn btn-stat-white" onclick="window.startActionFlow('TO')">TO</button>
              <button class="act-btn btn-stat-white" onclick="window.startActionFlow('FOUL_OFF')">Foul</button>
            </div>
          </div>

          <div class="pad-col">
            <button class="act-btn btn-make-3pt" onclick="window.startActionFlow('3PT_MADE')">
              <span class="act-big">+3</span>
              <span class="act-sub">PT FG</span>
            </button>
            <button class="act-btn btn-miss-3pt" onclick="window.startActionFlow('3PT_MISS')">
              <span class="act-big">3PT</span>
              <span class="act-sub">Miss</span>
            </button>
          </div>
        </div>
      `;
    } else {
      actionPadHtml = `
        <div class="action-pad defence-pad">
          <div class="defence-grid">
            <button class="act-btn btn-def-primary" onclick="window.startActionFlow('DREB')">
              <span class="act-big">DREB</span>
              <span class="act-sub">Defensive Rebound</span>
            </button>
            <button class="act-btn btn-def-primary" onclick="window.startActionFlow('STL')">
              <span class="act-big">STL</span>
              <span class="act-sub">Steal</span>
            </button>
            <button class="act-btn btn-def-primary" onclick="window.startActionFlow('BLK')">
              <span class="act-big">BLK</span>
              <span class="act-sub">Block</span>
            </button>
            <button class="act-btn btn-def-foul" onclick="window.startActionFlow('FOUL_DEF')">
              <span class="act-big">Foul</span>
              <span class="act-sub">Defensive Foul</span>
            </button>
          </div>
        </div>
      `;
    }

    // 3. On the Court 5 Bar
    const onCourtPlayers = (matchState.onCourtIds || [])
      .map(id => window.getPlayerById(id))
      .filter(Boolean);

    const onCourtChipsHtml = onCourtPlayers.map(p => {
      const m = p.manualMinOverride !== null && p.manualMinOverride !== undefined
        ? p.manualMinOverride
        : Math.round((p.secondsPlayed || 0) / 60);
      return `
        <div class="oncourt-chip">
          <div class="oc-name">${p.displayName}</div>
          <div id="oncourt-min-${p.id}" class="oc-min">${m}m</div>
        </div>
      `;
    }).join('');

    const onCourtBarHtml = `
      <div class="oncourt-bar">
        <div class="oncourt-header">
          <span>On the Court (${onCourtPlayers.length}/5)</span>
        </div>
        <div class="oncourt-row">
          <div class="oncourt-chips-wrap">
            ${onCourtChipsHtml || '<span class="empty-note">Tap SUB to put 5 players on the court</span>'}
          </div>
          <button class="btn-sub-circle" onclick="window.openSubModal()" title="Substitutions">
            ⇄<span>SUB</span>
          </button>
        </div>
      </div>
    `;

    // 4. Play-by-Play Feed with Undo, Edit Player/Zone, and Remove Action
    const recentEvents = [...matchState.events].reverse();
    const pbpRowsHtml = recentEvents.map(ev => {
      const hasMissing = ev.actionType !== 'OPP_SCORE' && (!ev.playerId || ((ev.actionType === '2PT_MADE' || ev.actionType === '3PT_MADE') && !ev.zoneId));
      return `
        <div class="pbp-item ${hasMissing ? 'pbp-needs-attention' : ''}">
          <div class="pbp-main" onclick="${ev.actionType !== 'OPP_SCORE' ? `window.openEditPlayModal('${ev.id}')` : ''}">
            <span class="pbp-time">${ev.period} ${window.formatClockMMSS(ev.clockRemaining)}</span>
            <span class="pbp-desc">${window.formatPlayEventDescription(ev)}</span>
          </div>
          <div class="pbp-actions">
            ${ev.actionType !== 'OPP_SCORE' ? `
              <button class="btn-pbp-edit" onclick="window.openEditPlayModal('${ev.id}')" title="Modify Player or Zone">✎ Edit</button>
            ` : ''}
            <button class="btn-pbp-del" onclick="window.removePlayEventById('${ev.id}')" title="Remove Action">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    const pbpSectionHtml = `
      <div class="pbp-card">
        <div class="pbp-header">
          <div>
            <h4>Play by Play (${matchState.events.length})</h4>
            <small>Tap any play to modify the player/zone or remove it</small>
          </div>
          <button class="btn-undo" onclick="window.undoLastAction()" ${matchState.events.length === 0 ? 'disabled' : ''}>
            ↩ Undo Last
          </button>
        </div>
        <div class="pbp-list">
          ${pbpRowsHtml || '<div class="pbp-empty">No plays recorded yet. Tap an action button above!</div>'}
        </div>
      </div>
    `;

    return toggleHtml + actionPadHtml + onCourtBarHtml + pbpSectionHtml;
  }

  function renderStatsTab(computed) {
    const poss = computed.possession;
    const h1PossText = poss.h1OffencePct !== null ? `H1: ${poss.h1OffencePct}%` : 'H1: -';
    const h2PossText = poss.h2OffencePct !== null ? `H2: ${poss.h2OffencePct}%` : 'H2: -';

    // Possession % Banner
    const possessionBannerHtml = `
      <div class="stats-possession-card">
        <div class="sp-header">
          <div>
            <span class="sp-label">${window.escapeHtml(matchState.teamName)} Possession %</span>
            <span class="sp-breakdown">(${h1PossText} • ${h2PossText})</span>
          </div>
          <span class="sp-big-pct">${poss.offencePct}%</span>
        </div>
        <div class="sp-bar-track">
          <div class="sp-bar-fill" style="width: ${poss.offencePct}%"></div>
        </div>
        <div class="sp-times-row">
          <span>🏀 Offence Time: <strong>${window.formatClockMMSS(poss.offenceSeconds)}</strong> (${poss.offencePct}%)</span>
          <span>🛡️ Defence Time: <strong>${window.formatClockMMSS(poss.defenceSeconds)}</strong> (${poss.defencePct}%)</span>
        </div>
      </div>
    `;

    // Sub-tabs Navigation + Export Toolbar
    const subNavHtml = `
      <div class="stats-subtabs-bar">
        <div class="stats-subtabs">
          <button class="subtab-btn ${activeStatsSubTab === 'BOX_SCORE' ? 'active' : ''}" onclick="window.switchStatsSubTab('BOX_SCORE')">
            📋 Box Score
          </button>
          <button class="subtab-btn ${activeStatsSubTab === 'SHOT_CHART' ? 'active' : ''}" onclick="window.switchStatsSubTab('SHOT_CHART')">
            🎯 Shot Chart (Hot/Cold)
          </button>
          <button class="subtab-btn ${activeStatsSubTab === 'GAME_FLOW' ? 'active' : ''}" onclick="window.switchStatsSubTab('GAME_FLOW')">
            📈 Game Flow & Recap
          </button>
        </div>
        <div class="export-actions-bar">
          <button id="btn-save-gdrive" class="btn-gdrive-save" onclick="window.triggerSaveToGoogleDrive()">
            ☁️ Save to Google Drive (_yyyymmddhhmmss)
          </button>
          <button class="btn-export-html" onclick="window.downloadEasyStatsHTML()">
            ⬇️ Download Easy Stats HTML
          </button>
          <button class="btn-gdrive-cfg" onclick="window.openDriveSettingsModal()" title="Google Drive Settings">
            ⚙️ Drive Setup
          </button>
        </div>
      </div>
    `;

    let subBodyHtml = '';

    if (activeStatsSubTab === 'BOX_SCORE') {
      const rowsHtml = computed.sortedPlayerRows.map(r => {
        const p = r.player;
        const isDnp = !p.isPlaying && !r.hasAnyAction && r.min === 0;
        const minDisp = isDnp ? '0:00' : window.formatPlayerMinDisplay(p);
        const fgPct = window.formatStatPct(r.fgMade, r.fgAtt);
        const fg3Pct = window.formatStatPct(r.fg3Made, r.fg3Att);
        const ftPct = window.formatStatPct(r.ftMade, r.ftAtt);
        const reb = r.oreb + r.dreb;

        return `
          <tr class="${isDnp ? 'dnp-row' : ''}">
            <td class="col-blue"><strong>${window.escapeHtml(p.displayName)}</strong> ${isDnp ? '<span class="badge-dnp">DNP</span>' : ''}</td>
            <td class="editable-min" onclick="window.promptEditPlayerMin('${p.id}')" title="Tap to edit minutes">${minDisp} ✎</td>
            <td class="col-blue">${r.fgMade}</td>
            <td class="col-blue">${r.fgAtt}</td>
            <td>${fgPct}</td>
            <td class="col-blue">${r.fg3Made}</td>
            <td class="col-blue">${r.fg3Att}</td>
            <td>${fg3Pct}</td>
            <td>${r.ftMade}</td>
            <td>${r.ftAtt}</td>
            <td>${ftPct}</td>
            <td>${r.oreb}</td>
            <td>${r.dreb}</td>
            <td>${reb}</td>
            <td>${r.asst}</td>
            <td>${r.stl}</td>
            <td>${r.blk}</td>
            <td>${r.to}</td>
            <td>${r.foul}</td>
            <td><strong>${r.pts}</strong></td>
            <td>${r.plusMinus}</td>
          </tr>
        `;
      }).join('');

      const t = computed.teamTotals;
      const totFgPct = window.formatStatPct(t.fgMade, t.fgAtt);
      const tot3Pct = window.formatStatPct(t.fg3Made, t.fg3Att);
      const totFtPct = window.formatStatPct(t.ftMade, t.ftAtt);
      const totReb = t.oreb + t.dreb;
      const teamPlusMinus = computed.ourTotalPts - computed.oppTotalPts;

      subBodyHtml = `
        <div class="boxscore-card">
          <div class="table-scroll-wrap">
            <table class="live-boxscore-table">
              <thead>
                <tr>
                  <th>PLAYER</th><th>MIN</th><th>FGM</th><th>FGA</th><th>FG%</th><th>3PM</th><th>3PA</th><th>3P%</th><th>FTM</th><th>FTA</th><th>FT%</th><th>OREB</th><th>DREB</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>PTS</th><th>+/-</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                <tr class="team-total-row">
                  <td><strong>TOTALS</strong></td>
                  <td></td>
                  <td class="col-blue"><strong>${t.fgMade}</strong></td>
                  <td class="col-blue"><strong>${t.fgAtt}</strong></td>
                  <td><strong>${totFgPct}</strong></td>
                  <td class="col-blue"><strong>${t.fg3Made}</strong></td>
                  <td class="col-blue"><strong>${t.fg3Att}</strong></td>
                  <td><strong>${tot3Pct}</strong></td>
                  <td><strong>${t.ftMade}</strong></td>
                  <td><strong>${t.ftAtt}</strong></td>
                  <td><strong>${totFtPct}</strong></td>
                  <td><strong>${t.oreb}</strong></td>
                  <td><strong>${t.dreb}</strong></td>
                  <td><strong>${totReb}</strong></td>
                  <td><strong>${t.asst}</strong></td>
                  <td><strong>${t.stl}</strong></td>
                  <td><strong>${t.blk}</strong></td>
                  <td><strong>${t.to}</strong></td>
                  <td><strong>${t.foul}</strong></td>
                  <td><strong>${computed.ourTotalPts}</strong></td>
                  <td><strong>${teamPlusMinus}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="boxscore-footnote">
            <span>*FGM/FGA includes 2pt &amp; 3pt field goals.</span>
            <span>Tip: Tap any player's <strong>MIN</strong> cell to manually adjust minutes.</span>
          </div>
        </div>
      `;
    } else if (activeStatsSubTab === 'SHOT_CHART') {
      const t = computed.teamTotals;
      const teamFgPct = t.fgAtt > 0 ? ((t.fgMade / t.fgAtt) * 100).toFixed(1) : '0.0';

      let activeZoneStats = computed.teamZoneStats;
      let active2Made = t.fg2Made, active2Att = t.fg2Att;
      let active3Made = t.fg3Made, active3Att = t.fg3Att;

      if (shotChartPlayerFilter !== 'ALL' && computed.playerStatsMap[shotChartPlayerFilter]) {
        const pr = computed.playerStatsMap[shotChartPlayerFilter];
        activeZoneStats = pr.zoneStats;
        active2Made = pr.fg2Made;
        active2Att = pr.fg2Att;
        active3Made = pr.fg3Made;
        active3Att = pr.fg3Att;
      }

      const pct2 = active2Att > 0 ? ((active2Made / active2Att) * 100).toFixed(1) : '0.0';
      const pct3 = active3Att > 0 ? ((active3Made / active3Att) * 100).toFixed(1) : '0.0';

      const dropdownOptions = [
        `<option value="ALL" ${shotChartPlayerFilter === 'ALL' ? 'selected' : ''}>All ${window.escapeHtml(matchState.teamName)} (${t.fgMade}/${t.fgAtt} - ${teamFgPct}%)</option>`
      ].concat(
        computed.sortedPlayerRows
          .filter(r => r.player.isPlaying || r.fgAtt > 0)
          .map(r => {
            const pPct = r.fgAtt > 0 ? ((r.fgMade / r.fgAtt) * 100).toFixed(1) : '0.0';
            return `<option value="${r.player.id}" ${shotChartPlayerFilter === r.player.id ? 'selected' : ''}>${window.escapeHtml(r.player.displayName)} (${r.fgMade}/${r.fgAtt} - ${pPct}%)</option>`;
          })
      ).join('');

      const filterPills = [
        `<button class="sc-pill ${shotChartPlayerFilter === 'ALL' ? 'active' : ''}" onclick="window.setShotChartPlayerFilter('ALL')">All Team</button>`
      ].concat(
        computed.sortedPlayerRows
          .filter(r => r.player.isPlaying || r.fgAtt > 0)
          .map(r => `<button class="sc-pill ${shotChartPlayerFilter === r.player.id ? 'active' : ''}" onclick="window.setShotChartPlayerFilter('${r.player.id}')">${window.escapeHtml(r.player.displayName)}</button>`)
      ).join('');

      subBodyHtml = `
        <div class="shotchart-card">
          <div class="shotchart-filter-bar">
            <select class="shotchart-player-select" onchange="window.setShotChartPlayerFilter(this.value)">
              ${dropdownOptions}
            </select>
            <div class="shotchart-pills-row">${filterPills}</div>
          </div>

          <div class="shotchart-svg-wrapper">
            ${window.buildHotColdShotChartSVG(activeZoneStats)}
          </div>

          <div class="shotchart-legend-bar">
            <span class="leg-item"><i class="leg-dot hot"></i> Hot (&ge;50%)</span>
            <span class="leg-item"><i class="leg-dot avg"></i> Average (33&ndash;49%)</span>
            <span class="leg-item"><i class="leg-dot cold"></i> Cold (&lt;33%)</span>
            <span class="leg-item"><i class="leg-dot none"></i> No Attempts</span>
          </div>

          <div class="shotchart-summary-cards">
            <div class="sc-sum-card">2PT: <strong>${active2Made}/${active2Att} (${pct2}%)</strong></div>
            <div class="sc-sum-card">3PT: <strong>${active3Made}/${active3Att} (${pct3}%)</strong></div>
          </div>
        </div>
      `;
    } else if (activeStatsSubTab === 'GAME_FLOW') {
      const recapVal = (matchState.recapEditedManually && matchState.customRecapText)
        ? matchState.customRecapText
        : window.generateOfflineRecap(matchState, computed);

      const periodHeaders = computed.periods.map(p => `<th>${p}</th>`).join('');
      const usPeriodCells = computed.periods.map(p => `<td>${(computed.periodScores[p] && computed.periodScores[p].us) || 0}</td>`).join('');
      const oppPeriodCells = computed.periods.map(p => `<td>${(computed.periodScores[p] && computed.periodScores[p].opp) || 0}</td>`).join('');

      subBodyHtml = `
        <div class="gameflow-recap-card">
          <h3>Game Flow</h3>
          <div class="canvas-scroll-wrap">
            <canvas id="live-gameflow-canvas" width="800" height="430"></canvas>
          </div>
          <table class="period-breakdown-table">
            <thead>
              <tr><th>Team</th>${periodHeaders}<th>Total</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>${window.escapeHtml(matchState.teamName)}</strong></td>${usPeriodCells}<td><strong>${computed.ourTotalPts}</strong></td></tr>
              <tr><td>${window.escapeHtml(matchState.opponentName)}</td>${oppPeriodCells}<td><strong>${computed.oppTotalPts}</strong></td></tr>
            </tbody>
          </table>

          <hr class="section-hr" />

          <div class="recap-editor-header">
            <h3>Offline Game Recap (Included in HTML Export)</h3>
            <button class="btn-secondary-sm" onclick="window.regenerateRecapFromStats()">🔄 Regenerate from Stats</button>
          </div>
          <textarea class="recap-textarea" rows="8" oninput="window.handleRecapTextareaInput(this)">${window.escapeHtml(recapVal)}</textarea>
        </div>
      `;
    }

    return possessionBannerHtml + subNavHtml + subBodyHtml;
  }

  function renderRosterSetupTab() {
    const startersCount = matchState.players.filter(p => p.isPlaying && p.isStarter).length;
    const playingCount = matchState.players.filter(p => p.isPlaying).length;
    const periodMins = Math.round((matchState.periodDurationSeconds || 1200) / 60);

    const rosterRowsHtml = matchState.players.map(p => {
      const statusBadge = !p.isPlaying
        ? `<span class="role-badge badge-absent">DNP / Absent</span>`
        : (p.isStarter
            ? `<button class="role-badge badge-starter" onclick="window.togglePlayerStarter('${p.id}')" title="Tap to switch to Bench">Starter ✓</button>`
            : `<button class="role-badge badge-bench" onclick="window.togglePlayerStarter('${p.id}')" title="Tap to make Starter">Bench</button>`);

      return `
        <div class="roster-setup-row ${!p.isPlaying ? 'row-absent' : ''}">
          <div class="rs-player-info">
            <span class="rs-jersey">#${window.escapeHtml(p.jersey)}</span>
            <div class="rs-names">
              <span class="rs-display">${window.escapeHtml(p.shortName)}</span>
              <small class="rs-fullname">${window.escapeHtml(p.fullName)} ${!p.isCore ? '• <em class="fillin-tag">Fill-In</em>' : ''}</small>
            </div>
          </div>

          <div class="rs-controls">
            ${statusBadge}
            <label class="switch-toggle" title="Playing Today">
              <input type="checkbox" ${p.isPlaying ? 'checked' : ''} onchange="window.togglePlayerPlaying('${p.id}')" />
              <span class="switch-slider"></span>
            </label>
            ${!p.isCore ? `<button class="btn-remove-fillin" onclick="window.removeFillInPlayer('${p.id}')" title="Remove Fill-In">✕</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const currentTeamKey = matchState.selectedTeamKey || 'B11_DD2';
    const currentPrefix = matchState.folderPrefix || (currentTeamKey === 'B15_DD5' ? '2026Summer_B15_DD5_' : '2026Summer_B11_DD2_');

    return `
      <div class="setup-grid">
        <div class="setup-card">
          <h3>Match Details — ${window.escapeHtml(matchState.teamName)}</h3>
          <div class="form-row">
            <label>Select Our Team (Before Game Start)</label>
            <div class="team-selector-pills">
              <button type="button" class="team-select-btn ${currentTeamKey === 'B11_DD2' ? 'active' : ''}"
                      onclick="window.selectTeamProfile('B11_DD2')">
                B11 Dunker 2 (Default)
                <small>Prefix: 2026Summer_B11_DD2_</small>
              </button>
              <button type="button" class="team-select-btn ${currentTeamKey === 'B15_DD5' ? 'active' : ''}"
                      onclick="window.selectTeamProfile('B15_DD5')">
                B15 Dunker 5
                <small>Prefix: 2026Summer_B15_DD5_</small>
              </button>
            </div>
            <small style="color:#64748b;font-size:12px;">Google Drive Save Folder: <code>${currentPrefix}${window.escapeHtml(matchState.opponentName)}_yyyymmddhhmmss</code></small>
          </div>
          <div class="form-row">
            <label>Opponent Team Name</label>
            <input type="text" value="${window.escapeHtml(matchState.opponentName)}"
                   onchange="window.updateMatchSetupField('opponentName', this.value)" />
          </div>
          <div class="form-row-2col">
            <div>
              <label>Match Date</label>
              <input type="text" value="${window.escapeHtml(matchState.gameDate)}"
                     onchange="window.updateMatchSetupField('gameDate', this.value)" />
            </div>
            <div>
              <label>Countdown Per Half (Mins)</label>
              <input type="number" min="1" max="60" value="${periodMins}"
                     onchange="window.updateMatchSetupField('periodDurationMinutes', this.value)" />
            </div>
          </div>
          <div class="form-row-2col">
            <div>
              <label>Venue Type</label>
              <select onchange="window.updateMatchSetupField('isHomeGame', this.value === 'true')">
                <option value="false" ${!matchState.isHomeGame ? 'selected' : ''}>Away Game</option>
                <option value="true" ${matchState.isHomeGame ? 'selected' : ''}>Home Game</option>
              </select>
            </div>
            <div>
              <label>Season Record (Optional for Recap)</label>
              <input type="text" placeholder="e.g. 3-1" value="${window.escapeHtml(matchState.seasonRecord || '')}"
                     onchange="window.updateMatchSetupField('seasonRecord', this.value)" />
            </div>
          </div>
          <div class="form-row">
            <label>Opponent Logo (Optional Image Upload)</label>
            <input type="file" accept="image/*" onchange="window.handleOpponentLogoUpload(this)" />
          </div>
          <div class="setup-utility-btns">
            <button class="btn-secondary-sm" onclick="window.downloadMatchJSON()">💾 Backup Match JSON</button>
            <label class="btn-secondary-sm file-btn-label">
              📂 Load Match JSON
              <input type="file" accept=".json" style="display:none" onchange="window.importMatchJSONFile(this)" />
            </label>
            <button class="btn-danger-sm" onclick="window.resetNewMatch()">🔄 Start Fresh Match</button>
          </div>
        </div>

        <div class="setup-card">
          <div class="roster-card-header">
            <div>
              <h3>Select Match Roster &amp; Starting 5</h3>
              <small>Loaded once from Google Drive (<code>1-GSovenRouWVnOw-L9kbSbrT061SLLT9</code>). Zero Google connection needed during live scoring.</small>
            </div>
          </div>

          <div class="setup-utility-btns" style="margin-top:8px;margin-bottom:10px;">
            <button id="btn-sync-roster" class="btn-primary-sm" onclick="window.syncRostersFromGoogleDriveOnce(false)">
              ☁️ Load Roster from Google Drive
            </button>
            <button class="btn-secondary-sm" onclick="window.openDriveSettingsModal()">
              ⚙️ Setup Google Connection Key
            </button>
            <label class="btn-secondary-sm file-btn-label">
              📂 Load teams_rosters.json
              <input type="file" accept=".json" style="display:none" onchange="window.importRosterJSONFile(this)" />
            </label>
          </div>

          <div class="roster-setup-list">
            ${rosterRowsHtml || '<div class="empty-note" style="padding:14px;text-align:center;color:#64748b;">No roster loaded yet. Tap <strong>"☁️ Load Roster from Google Drive"</strong> or <strong>"⚙️ Setup Google Connection Key"</strong> above.</div>'}
          </div>

          <div class="fillin-box">
            <h4>+ Add One-Off Fill-In Player</h4>
            <div class="fillin-inputs">
              <input type="text" id="fillin-jersey" placeholder="Jersey #" class="input-jersey" />
              <input type="text" id="fillin-firstname" placeholder="First Name (full)" />
              <input type="text" id="fillin-lastname" placeholder="Last Name" />
              <button class="btn-add-fillin" onclick="window.addFillInPlayer()">+ Add</button>
            </div>
          </div>

          <button class="btn-start-match" onclick="window.switchTab('SCORING')">
            🏀 Go to Live Scoring (${playingCount} Players Active) →
          </button>
        </div>
      </div>
    `;
  }

  // Initialize on DOM load
  window.addEventListener('DOMContentLoaded', () => {
    renderApp();
    if (!matchState.players || matchState.players.length === 0) {
      window.syncRostersFromGoogleDriveOnce(true);
    }
  });
})();
