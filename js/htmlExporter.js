// Generates the standalone Easy Stats-style HTML Box Score Report
// - Uses the #0f9bc5 blue gradient from reference image 2
// - Uses the 21-column box score table (PLAYER, MIN, FGM, FGA, FG%, 3PM, 3PA, 3P%, FTM, FTA, FT%, OREB, DREB, REB, AST, STL, BLK, TO, PF, PTS, +/-) from reference image 1

window.escapeHtml = function(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

window.getExportHtmlFilename = function(state) {
  const us = (state.teamName || 'B11 Dunker 2').replace(/[/\\?%*:|"<>]/g, '-');
  const opp = (state.opponentName || 'Opponent').replace(/[/\\?%*:|"<>]/g, '-');
  const dateStr = (state.gameDate || '').replace(/[/\\?%*:|"<>]/g, '-');
  return `${us} vs ${opp} box-scores-${dateStr}.html`;
};

window.generateEasyStatsHTML = function(state, computed, flowImgDataUrl) {
  const usName = window.escapeHtml(state.teamName || 'B11 Dunker 2');
  const oppName = window.escapeHtml(state.opponentName || 'Opponent');
  const dateStr = window.escapeHtml(state.gameDate || '');
  const ourPts = computed.ourTotalPts;
  const oppPts = computed.oppTotalPts;
  const usLogo = state.teamLogo || window.DUNKERS_CONFIG.teamLogoBase64;
  const oppLogo = state.opponentLogo || window.DUNKERS_CONFIG.defaultOpponentLogoBase64;

  // Build 21-Column Box Score Table matching Reference Image 1:
  // PLAYER | MIN | FGM | FGA | FG% | 3PM | 3PA | 3P% | FTM | FTA | FT% | OREB | DREB | REB | AST | STL | BLK | TO | PF | PTS | +/-
  let statsRowsHtml = `<thead><tr><th>PLAYER</th><th>MIN</th><th>FGM</th><th>FGA</th><th>FG%</th><th>3PM</th><th>3PA</th><th>3P%</th><th>FTM</th><th>FTA</th><th>FT%</th><th>OREB</th><th>DREB</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>PTS</th><th>+/-</th></tr></thead><tbody>`;

  for (const r of computed.sortedPlayerRows) {
    const p = r.player;
    const isDnp = !p.isPlaying && !r.hasAnyAction && r.min === 0;
    if (isDnp && !state.includeDnpInHtml) {
      continue;
    }

    const pName = window.escapeHtml(p.displayName || `#${p.jersey} ${p.firstName} ${(p.lastName || '').charAt(0)}.`);
    const minDisp = isDnp ? '0:00' : window.formatPlayerMinDisplay(p);
    const fgPct = window.formatStatPct(r.fgMade, r.fgAtt);
    const fg3Pct = window.formatStatPct(r.fg3Made, r.fg3Att);
    const ftPct = window.formatStatPct(r.ftMade, r.ftAtt);
    const reb = r.oreb + r.dreb;

    statsRowsHtml += `<tr>` +
      `<td class='col-player'>${pName}</td>` +
      `<td>${minDisp}</td>` +
      `<td class='col-blue'>${r.fgMade}</td>` +
      `<td class='col-blue'>${r.fgAtt}</td>` +
      `<td>${fgPct}</td>` +
      `<td class='col-blue'>${r.fg3Made}</td>` +
      `<td class='col-blue'>${r.fg3Att}</td>` +
      `<td>${fg3Pct}</td>` +
      `<td>${r.ftMade}</td>` +
      `<td>${r.ftAtt}</td>` +
      `<td>${ftPct}</td>` +
      `<td>${r.oreb}</td>` +
      `<td>${r.dreb}</td>` +
      `<td>${reb}</td>` +
      `<td>${r.asst}</td>` +
      `<td>${r.stl}</td>` +
      `<td>${r.blk}</td>` +
      `<td>${r.to}</td>` +
      `<td>${r.foul}</td>` +
      `<td>${r.pts}</td>` +
      `<td>${r.plusMinus}</td>` +
      `</tr>`;
  }

  const t = computed.teamTotals;
  const totFgPct = window.formatStatPct(t.fgMade, t.fgAtt);
  const tot3Pct = window.formatStatPct(t.fg3Made, t.fg3Att);
  const totFtPct = window.formatStatPct(t.ftMade, t.ftAtt);
  const totReb = t.oreb + t.dreb;
  const teamPlusMinus = ourPts - oppPts;

  statsRowsHtml += `<tr class='totals-row'>` +
    `<td>TOTALS</td>` +
    `<td></td>` +
    `<td class='col-blue'>${t.fgMade}</td>` +
    `<td class='col-blue'>${t.fgAtt}</td>` +
    `<td>${totFgPct}</td>` +
    `<td class='col-blue'>${t.fg3Made}</td>` +
    `<td class='col-blue'>${t.fg3Att}</td>` +
    `<td>${tot3Pct}</td>` +
    `<td>${t.ftMade}</td>` +
    `<td>${t.ftAtt}</td>` +
    `<td>${totFtPct}</td>` +
    `<td>${t.oreb}</td>` +
    `<td>${t.dreb}</td>` +
    `<td>${totReb}</td>` +
    `<td>${t.asst}</td>` +
    `<td>${t.stl}</td>` +
    `<td>${t.blk}</td>` +
    `<td>${t.to}</td>` +
    `<td>${t.foul}</td>` +
    `<td>${ourPts}</td>` +
    `<td>${teamPlusMinus}</td>` +
    `</tr></tbody>`;

  // Build Period Breakdown Table <table id='gameflow'>
  const periodHeaders = computed.periods.map(p => `<th>${window.escapeHtml(p)}</th>`).join('');
  const usPeriodCells = computed.periods.map(p => `<td>${(computed.periodScores[p] && computed.periodScores[p].us) || 0}</td>`).join('');
  const oppPeriodCells = computed.periods.map(p => `<td>${(computed.periodScores[p] && computed.periodScores[p].opp) || 0}</td>`).join('');

  const gameFlowTableHtml = `<table id='gameflow'><tr><th></th>${periodHeaders}</tr><tr><td>${usName}</td>${usPeriodCells}</tr><tr><td>${oppName}</td>${oppPeriodCells}</tr></table>`;

  // Possession % summary row
  const poss = computed.possession;
  const possText = `${usName} Possession: ${poss.offencePct}% (Offence: ${window.formatClockMMSS(poss.offenceSeconds)} | Defence: ${window.formatClockMMSS(poss.defenceSeconds)})`;

  // Pre-render Team & Per-Player Hot/Cold Shot Chart SVGs
  const chartPayloads = {
    ALL: {
      label: `${state.teamName} — All Players (${t.fgMade}-${t.fgAtt} FG)`,
      svg: window.buildHotColdShotChartSVG(computed.teamZoneStats)
    }
  };
  let selectOptionsHtml = `<option value="ALL">${usName} — All Players (${t.fgMade}-${t.fgAtt} FG)</option>`;
  for (const r of computed.sortedPlayerRows) {
    if (r.fgAtt > 0 || r.player.isPlaying) {
      const pid = r.player.id;
      const label = `${r.player.displayName} (${r.fgMade}-${r.fgAtt} FG, ${r.pts} pts)`;
      chartPayloads[pid] = {
        label,
        svg: window.buildHotColdShotChartSVG(r.zoneStats)
      };
      selectOptionsHtml += `<option value="${window.escapeHtml(pid)}">${window.escapeHtml(label)}</option>`;
    }
  }

  // Recap Text
  const rawRecap = (state.recapEditedManually && state.customRecapText.trim())
    ? state.customRecapText.trim()
    : window.generateOfflineRecap(state, computed);
  const recapHtml = window.escapeHtml(rawRecap).replace(/\n\n+/g, '<br /><br />').replace(/\n/g, '<br />');

  return `<!DOCTYPE html><html lang='en'><head><title>${usName} ${ourPts} at ${oppName} ${oppPts}</title>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>body{font-family:'Droid Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#fff;font-size:18px;color:#1e293b}div#main{width:1080px;max-width:100%;margin:0 auto}div#header{text-align:center;height:80px;background-color:#0f9bc5;border-radius:4px 4px 0 0;border-top:#0f9bc5 solid 1px}div#header span{display:inline-block;margin-top:8px;position:relative}div#header span a{display:inline-block;color:#fff;text-decoration:none}div#header span div{padding:0 0 3px 0}div#header span a img{height:40px;display:inline-block;vertical-align:middle}div#header span a text{font-weight:700;color:#fff;display:inline-block}div#teams-hdr{width:100%;background:#0f9bc5;background:linear-gradient(180deg,#0f9bc5 0,#fff 100%,#fafafa 100%);padding-bottom:70px}div#teams-hdr-info{width:100%;padding-top:24px;color:#fff;display:inline-block}div#team-score-left{text-align:right;padding-right:8px}div#team-score-right{text-align:left;padding-left:8px}div.games-hdr div#team-score-left{text-align:left;padding-left:8px}div.games-hdr div#team-score-right{text-align:right;padding-right:8px}div.lineup-hdr div#team-score-left .title,div.lineup-hdr div#team-score-right .title{font-size:22px}div div#team-score-left,div div#team-score-right{margin-top:40px}div#team-score-left span,div#team-score-right span{overflow-wrap:break-word}div#game-date{text-align:center}div#footnote{margin-top:10px;font-size:13.5px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;color:#475569;padding:0 4px}div.team-logo{border:#fff solid 2px;border-radius:50%;height:100%;width:100%;text-align:center;overflow:hidden;background:#111}div.team-logo img{height:100%;width:100%;object-fit:contain}div.logo-container{width:122px;height:122px}div#score-logo-container,div#team-names-container{text-align:center}div#score-logo-container>div,div#team-names-container>div{display:inline-block;width:400px}div#team-names-container div.left{text-align:center}div#team-names-container div.right{text-align:center}div#team-names-container div.left,div#team-names-container div.right{width:122px;padding-top:8px}div#team-names-container div.left span,div#team-names-container div.right span{overflow-wrap:break-word;color:#0f172a;font-weight:700}div#stats-container{margin-top:-36px;overflow-x:auto;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.06)}table#stats{width:100%;padding:0;border-collapse:collapse;min-width:980px;font-size:13.5px}table#stats thead th{color:#94a3b8;font-weight:700;font-size:11.5px;letter-spacing:0.4px;padding:12px 6px;border-bottom:1px solid #e2e8f0;text-align:center}table#stats thead th:first-child{text-align:left;padding-left:14px}table#stats tbody td{padding:11px 6px;border-bottom:1px solid #f1f5f9;text-align:center;color:#334155;font-variant-numeric:tabular-nums}table#stats tbody td:first-child{width:160px;min-width:160px;padding-left:14px;text-align:left;border-right:1px solid #f1f5f9;position:sticky;left:0;background:#fff;z-index:1}table#stats td.col-player{color:#0083b9;font-weight:600}table#stats td.col-blue{color:#0083b9}table#stats tr.totals-row td{font-weight:800;color:#0f172a;border-top:2px solid #e2e8f0;border-bottom:none;padding-top:13px;padding-bottom:13px}table#stats tr.totals-row td.col-blue{color:#0083b9}table#gameflow{padding:0;border-collapse:separate;table-layout:fixed;min-width:400px;font-size:14px;margin-left:auto;margin-right:auto;margin-bottom:40px}table#gameflow td{column-width:auto;padding:0;border-top:rgba(0,0,0,.1) solid 1px}table#gameflow td:first-child{width:140px;max-width:140px;overflow-wrap:break-word;padding-left:8px;text-align:left;border-right:rgba(0,0,0,.1) solid 1px}.detail{font-size:18px}.title{font-weight:700;font-size:36px}.left{float:left}.right{float:right}tr{height:40px}td{text-align:center}div#shotcharts{margin-top:24px;text-align:center}div#shotcharts-inner{max-width:460px;margin:16px auto}div#shotchart-legend{display:flex;justify-content:center;gap:18px;font-size:14px;margin-top:10px;flex-wrap:wrap}div#gameRecap p{line-height:2}table#charts{width:100%;border-collapse:separate;border-spacing:0 24px}table#charts select,select#shotchart-select{text-align:center;font-weight:700;font-size:16px;padding:8px 12px;border-radius:6px;border:1px solid #cbd5e1;margin-bottom:12px}div#gameflow-container{text-align:center;overflow-x:auto}@media print{div#teams-hdr-info{color:#000}div#header span a text{color:#000}}@media (max-width:600px){body{font-size:14px}.title{font-size:28px}.detail{font-size:18px}table#charts select{font-size:14px}div#main{width:100%;margin:0}div#game-date{margin-bottom:16px}div.games-hdr div#team-score-left,div.games-hdr div#team-score-right{width:auto;margin-top:24px}div#score-logo-container>div,div#team-names-container>div{width:300px}div.lineup-hdr div#team-score-left,div.lineup-hdr div#team-score-right,div.team-hdr div#team-score-right{margin-top:0}div#team-score-left,div#team-score-right{width:50%}div.games-hdr div.logo-container{width:80px;height:80px}div#team-names-container div.left,div#team-names-container div.right{width:80px}table#charts img{height:300px;width:300px}div#stats-container{overflow-x:auto}div#plots{overflow-x:auto}div#plots td canvas{width:300px;height:300px}div#plots table#charts{border-spacing:16px 16px}div#gameflow-container img{width:550px}}</style>
</head><body><div id='main'><div id='header'><span><a href='#'><div><img src='${usLogo}' alt='dunkers logo' /></div><div><text>Easy Stats — ${usName}</text></div></a></span></div><div id='teams-hdr'><div id='teams-hdr-info' class='games-hdr'><div id='game-date'><span class='detail'>${dateStr}</span></div><div id='score-logo-container'><div><div class='logo-container left'><div class='team-logo'><img alt='away logo' src='${usLogo}'/></div></div><div id='team-score-left' class='left'><div><span class='title'>${ourPts}</span></div></div><div class='logo-container right'><div class='team-logo'><img alt='home logo' src='${oppLogo}'/></div></div><div id='team-score-right' class='right'><div><span class='title'>${oppPts}</span></div></div></div></div><div id='team-names-container'><div><div class='left'><span class='detail'>${usName}</span></div><div class='right'><span class='detail'>${oppName}</span></div></div></div></div></div><div id='stats-container'><table id='stats'>${statsRowsHtml}</table></div><div id='footnote'><span>*FGM/FGA includes 2pt &amp; 3pt field goals.</span><span><strong>${possText}</strong></span></div><div id='gameFlow'><hr /><h2>Game Flow</h2><div id='gameflow-container'><div><img alt='flow img' src='${flowImgDataUrl}'/></div><div>${gameFlowTableHtml}</div></div></div><div id='shotcharts'><hr /><h2>Shot Chart (Hot &amp; Cold Zones)</h2><div><select id='shotchart-select' onchange='window.switchExportShotChart(this.value)'>${selectOptionsHtml}</select></div><div id='shotcharts-inner'>${chartPayloads.ALL.svg}</div><div id='shotchart-legend'><span><strong style='color:#c81e1e'>&#9632;</strong> Hot (&ge;50%)</span><span><strong style='color:#d97706'>&#9632;</strong> Average (33&ndash;49%)</span><span><strong style='color:#1d6feb'>&#9632;</strong> Cold (&lt;33%)</span><span><strong style='color:#334155'>&#9632;</strong> No Attempts</span></div></div><div id='gameRecap'><hr /><h2>Recap</h2><p>${recapHtml}</p></div></div>
<script>
window.EXPORT_SHOT_CHARTS = ${JSON.stringify(chartPayloads)};
window.switchExportShotChart = function(key) {
  var item = window.EXPORT_SHOT_CHARTS[key] || window.EXPORT_SHOT_CHARTS['ALL'];
  var el = document.getElementById('shotcharts-inner');
  if (el && item) el.innerHTML = item.svg;
};
</script>
</body></html>`;
};
