// 11-Zone Half-Court Geometry (Matching Hand-Drawn Diagram), Interactive Selector & Hot/Cold Shot Chart

window.COURT_ZONES = [
  // 6 Two-Point Zones (Inside the 3PT Arc)
  {
    id: '2PT_PAINT',
    name: 'Paint',
    shortLabel: 'Paint',
    type: '2PT',
    // Strictly the upper rectangle from baseline (y=0) to free-throw line (y=185)
    path: 'M 175 0 L 325 0 L 325 185 L 175 185 Z',
    labelX: 250,
    labelY: 118
  },
  {
    id: '2PT_SHORT_CORNER_L',
    name: 'Short Corner (Left)',
    shortLabel: 'Short Corner (Left)',
    type: '2PT',
    // Between vertical 3pt corner line (x=40) and Paint left edge (x=175), above upper diagonal ray
    path: 'M 40 0 L 175 0 L 175 95 L 40 148 Z',
    labelX: 108,
    labelY: 58
  },
  {
    id: '2PT_SHORT_CORNER_R',
    name: 'Short Corner (Right)',
    shortLabel: 'Short Corner (Right)',
    type: '2PT',
    // Between Paint right edge (x=325) and vertical 3pt corner line (x=460), above upper diagonal ray
    path: 'M 325 0 L 460 0 L 460 148 L 325 95 Z',
    labelX: 392,
    labelY: 58
  },
  {
    id: '2PT_ELBOW_L',
    name: 'Elbow (Left)',
    shortLabel: 'Elbow (Left)',
    type: '2PT',
    // Below upper diagonal ray, left of Paint (x=175), above lower elbow ray, inside 3PT arc (R=232.6)
    path: 'M 175 95 L 175 185 L 140.8 253.4 A 232.6 232.6 0 0 1 40 148 Z',
    labelX: 115,
    labelY: 170
  },
  {
    id: '2PT_ELBOW_R',
    name: 'Elbow (Right)',
    shortLabel: 'Elbow (Right)',
    type: '2PT',
    // Below upper diagonal ray, right of Paint (x=325), above lower elbow ray, inside 3PT arc (R=232.6)
    path: 'M 325 95 L 460 148 A 232.6 232.6 0 0 1 359.2 253.4 L 325 185 Z',
    labelX: 385,
    labelY: 170
  },
  {
    id: '2PT_TOP_KEY',
    name: 'Top of the key',
    shortLabel: 'Top of the key',
    type: '2PT',
    // Starts at horizontal FT line (y=185, including the FT semicircle inside it) down to 3PT arc between elbow rays
    path: 'M 175 185 L 325 185 L 359.2 253.4 A 232.6 232.6 0 0 1 140.8 253.4 Z',
    labelX: 250,
    labelY: 245
  },

  // 5 Three-Point Zones (Outside the 3PT Arc)
  {
    id: '3PT_CORNER_L',
    name: 'Corner (Left)',
    shortLabel: 'Corner (Left)',
    type: '3PT',
    // Left sideline (x=0) to left 3pt vertical line (x=40), above upper diagonal ray extension
    path: 'M 0 0 L 40 0 L 40 148 L 0 163.7 Z',
    labelX: 20,
    labelY: 78,
    verticalText: true
  },
  {
    id: '3PT_CORNER_R',
    name: 'Corner (Right)',
    shortLabel: 'Corner (Right)',
    type: '3PT',
    // Right 3pt vertical line (x=460) to right sideline (x=500), above upper diagonal ray extension
    path: 'M 460 0 L 500 0 L 500 163.7 L 460 148 Z',
    labelX: 480,
    labelY: 78,
    verticalText: true
  },
  {
    id: '3PT_WING_L',
    name: 'Wing (Left)',
    shortLabel: 'Wing (Left)',
    type: '3PT',
    // Below upper diagonal ray, outside 3PT arc, left of lower elbow ray (which extends to (37.5, 460))
    path: 'M 0 163.7 L 40 148 A 232.6 232.6 0 0 0 140.8 253.4 L 37.5 460 L 0 460 Z',
    labelX: 56,
    labelY: 300
  },
  {
    id: '3PT_WING_R',
    name: 'Wing (Right)',
    shortLabel: 'Wing (Right)',
    type: '3PT',
    // Below upper diagonal ray, outside 3PT arc, right of lower elbow ray (which extends to (462.5, 460))
    path: 'M 460 148 L 500 163.7 L 500 460 L 462.5 460 L 359.2 253.4 A 232.6 232.6 0 0 0 460 148 Z',
    labelX: 444,
    labelY: 300
  },
  {
    id: '3PT_TOP_ARC',
    name: 'Top of the arc',
    shortLabel: 'Top of the arc',
    type: '3PT',
    // Below 3PT arc between the two straight lower elbow rays down to bottom half-court (y=460)
    path: 'M 140.8 253.4 A 232.6 232.6 0 0 0 359.2 253.4 L 462.5 460 L 37.5 460 Z',
    labelX: 250,
    labelY: 368
  }
];

window.getZoneById = function(zoneId) {
  return window.COURT_ZONES.find(z => z.id === zoneId) || null;
};

/**
 * Generates the interactive SVG markup for selecting a shot zone.
 * - Strictly locks 3PT zones when shotType === '2PT', and locks 2PT zones when shotType === '3PT'.
 * - Renders a glowing highlight, pulsing border, ripple ring, and checkmark when a zone is selected.
 */
window.buildZoneSelectorSVG = function(shotType, selectedZoneId) {
  const activeType = shotType === 3 || shotType === '3PT' ? '3PT' : '2PT';

  let zonesHtml = '';
  for (const zone of window.COURT_ZONES) {
    const isAllowed = zone.type === activeType;
    const isSelected = zone.id === selectedZoneId;

    let fill = isAllowed ? (activeType === '2PT' ? '#243b55' : '#1e3c58') : '#1c2026';
    let stroke = isAllowed ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.18)';
    let strokeWidth = isAllowed ? '2' : '1.5';
    let cursorClass = isAllowed ? 'zone-active' : 'zone-locked';

    if (isSelected) {
      fill = 'url(#selectedZoneGrad)';
      stroke = '#ffd166';
      strokeWidth = '4';
      cursorClass += ' zone-selected';
    }

    const clickAttr = isAllowed ? `onclick="window.handleCourtZoneClick('${zone.id}')"` : '';

    // Zone polygon path
    zonesHtml += `
      <g class="court-zone-group ${cursorClass}" data-zone-id="${zone.id}" ${clickAttr}>
        <path d="${zone.path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" class="zone-path" />
    `;

    // Ripple effect rings if selected
    if (isSelected) {
      zonesHtml += `
        <circle cx="${zone.labelX}" cy="${zone.labelY}" r="22" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="2.5" class="zone-ripple-ring" />
        <circle cx="${zone.labelX}" cy="${zone.labelY}" r="36" fill="none" stroke="rgba(16,185,129,0.55)" stroke-width="2" class="zone-ripple-ring-outer" />
      `;
    }

    // Zone text label & lock icon if locked
    const textColor = isSelected ? '#ffffff' : (isAllowed ? '#f1f5f9' : '#64748b');
    const fontWeight = isSelected ? '800' : (isAllowed ? '700' : '600');

    if (zone.verticalText) {
      const rot = zone.id === '3PT_CORNER_L' ? -90 : 90;
      const lockSuffix = !isAllowed ? ' 🔒' : (isSelected ? ' ✓' : '');
      zonesHtml += `
        <text x="${zone.labelX}" y="${zone.labelY}" fill="${textColor}" font-size="12.5" font-weight="${fontWeight}"
              text-anchor="middle" dominant-baseline="middle"
              transform="rotate(${rot} ${zone.labelX} ${zone.labelY})"
              style="pointer-events:none; user-select:none;">
          ${zone.shortLabel}${lockSuffix}
        </text>
      `;
    } else {
      const parts = zone.shortLabel.split(' (');
      const line1 = parts[0];
      const line2 = parts[1] ? '(' + parts[1] : '';

      if (line2) {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY - 8}" fill="${textColor}" font-size="13.5" font-weight="${fontWeight}"
                text-anchor="middle" style="pointer-events:none; user-select:none;">${line1}</text>
          <text x="${zone.labelX}" y="${zone.labelY + 10}" fill="${textColor}" font-size="13" font-weight="${fontWeight}"
                text-anchor="middle" style="pointer-events:none; user-select:none;">${line2}</text>
        `;
      } else {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY}" fill="${textColor}" font-size="14" font-weight="${fontWeight}"
                text-anchor="middle" dominant-baseline="middle" style="pointer-events:none; user-select:none;">${line1}</text>
        `;
      }

      if (!isAllowed) {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY + (line2 ? 28 : 20)}" fill="#64748b" font-size="13"
                text-anchor="middle" style="pointer-events:none; user-select:none;">🔒</text>
        `;
      } else if (isSelected) {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY + (line2 ? 29 : 21)}" fill="#ffd166" font-size="13" font-weight="800"
                text-anchor="middle" style="pointer-events:none; user-select:none;">✓ SELECTED</text>
        `;
      }
    }

    zonesHtml += `</g>`;
  }

  // Court Markings Overlay:
  // 1. Backboard & Hoop inside Paint
  // 2. Free-Throw Semicircle drawn INSIDE Top of the key (from (190,185) to (310,185) curving down to y=245)
  const courtMarkings = `
    <g style="pointer-events:none;">
      <!-- Outer court boundary -->
      <rect x="1" y="1" width="498" height="458" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2.5" />
      <!-- Backboard and Rim inside Paint -->
      <line x1="220" y1="30" x2="280" y2="30" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="250" cy="48" r="14" fill="none" stroke="#ffffff" stroke-width="3" />
      <!-- Free-Throw Semicircle inside Top of the key -->
      <path d="M 190 185 A 60 60 0 0 0 310 185" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2.5" />
    </g>
  `;

  return `
    <svg viewBox="0 0 500 460" width="100%" height="100%" class="court-zone-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="selectedZoneGrad" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#10b981" />
          <stop offset="70%" stop-color="#059669" />
          <stop offset="100%" stop-color="#047857" />
        </radialGradient>
      </defs>
      ${zonesHtml}
      ${courtMarkings}
    </svg>
  `;
};

/**
 * Generates the Hot & Cold Zone Shot Chart SVG for the Stats Tab & HTML Export.
 * zoneStatsMap: { [zoneId]: { made: number, att: number } }
 */
window.buildHotColdShotChartSVG = function(zoneStatsMap) {
  let zonesHtml = '';

  for (const zone of window.COURT_ZONES) {
    const st = (zoneStatsMap && zoneStatsMap[zone.id]) || { made: 0, att: 0 };
    const made = st.made || 0;
    const att = st.att || 0;
    const pct = att > 0 ? Math.round((made / att) * 100) : null;

    // Color scale:
    // Hot (>= 50%): Crimson Red (#c81e1e)
    // Average (33% - 49%): Amber / Gold (#d97706)
    // Cold (< 33% with >= 1 att): Blue (#1d6feb)
    // No attempts: Slate Gray (#334155)
    let fill = '#334155';
    if (att > 0) {
      if (pct >= 50) {
        fill = '#c81e1e';
      } else if (pct >= 33) {
        fill = '#d97706';
      } else {
        fill = '#1d6feb';
      }
    }

    zonesHtml += `
      <g class="shotchart-zone">
        <path d="${zone.path}" fill="${fill}" stroke="#ffffff" stroke-width="2.5" />
    `;

    const statText = att > 0 ? `${made}/${att} (${pct}%)` : `0/0 (-)`;

    if (zone.verticalText) {
      const rot = zone.id === '3PT_CORNER_L' ? -90 : 90;
      zonesHtml += `
        <text x="${zone.labelX}" y="${zone.labelY}" fill="#ffffff" font-size="12.5" font-weight="700"
              text-anchor="middle" dominant-baseline="middle"
              transform="rotate(${rot} ${zone.labelX} ${zone.labelY})"
              font-family="sans-serif">
          ${statText}
        </text>
      `;
    } else {
      const parts = zone.shortLabel.split(' (');
      const line1 = parts[0];
      const line2 = parts[1] ? '(' + parts[1] : '';

      if (line2) {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY - 16}" fill="rgba(255,255,255,0.92)" font-size="13" font-weight="700"
                text-anchor="middle" font-family="sans-serif">${line1}</text>
          <text x="${zone.labelX}" y="${zone.labelY}" fill="rgba(255,255,255,0.88)" font-size="12" font-weight="600"
                text-anchor="middle" font-family="sans-serif">${line2}</text>
          <text x="${zone.labelX}" y="${zone.labelY + 19}" fill="#ffffff" font-size="14" font-weight="800"
                text-anchor="middle" font-family="sans-serif">${statText}</text>
        `;
      } else {
        zonesHtml += `
          <text x="${zone.labelX}" y="${zone.labelY - 8}" fill="rgba(255,255,255,0.92)" font-size="13.5" font-weight="700"
                text-anchor="middle" font-family="sans-serif">${line1}</text>
          <text x="${zone.labelX}" y="${zone.labelY + 12}" fill="#ffffff" font-size="14.5" font-weight="800"
                text-anchor="middle" font-family="sans-serif">${statText}</text>
        `;
      }
    }

    zonesHtml += `</g>`;
  }

  const courtMarkings = `
    <g style="pointer-events:none;">
      <rect x="1.5" y="1.5" width="497" height="457" fill="none" stroke="#ffffff" stroke-width="3" />
      <!-- Backboard and Rim inside Paint -->
      <line x1="220" y1="30" x2="280" y2="30" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="250" cy="48" r="14" fill="none" stroke="#ffffff" stroke-width="3" />
      <!-- Dashed Free-Throw Semicircle inside Top of the key -->
      <path d="M 190 185 A 60 60 0 0 0 310 185" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="7,6" />
    </g>
  `;

  return `
    <svg viewBox="0 0 500 460" width="100%" height="100%" class="shot-chart-svg" xmlns="http://www.w3.org/2000/svg">
      ${zonesHtml}
      ${courtMarkings}
    </svg>
  `;
};
