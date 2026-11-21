// Google Drive Integration for Basketball Scoreboard
// - Connection #1 (Pre-Game Setup): Loads Teams & Player Rosters ONCE from folder 1-GSovenRouWVnOw-L9kbSbrT061SLLT9
// - Live Scoring: ZERO Google connections (100% offline in browser memory / localStorage)
// - Connection #2 (Post-Game Save): Saves match HTML & JSON ONCE to folder 14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1
//   inside a newly created subfolder with prefix "2026Summer_B11_DD2_" or "2026Summer_B15_DD5_" and suffix "_yyyymmddhhmmss"

window.getTimestampYYYYMMDDHHMMSS = function(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
};

window.buildSubfolderName = function(state, timestampStr) {
  const ts = timestampStr || window.getTimestampYYYYMMDDHHMMSS();
  const prefix = state.folderPrefix || (state.selectedTeamKey === 'B15_DD5' ? '2026Summer_B15_DD5_' : '2026Summer_B11_DD2_');
  const opp = (state.opponentName || 'Opponent').replace(/[/\\?%*:|"<>]/g, '-').trim();
  return `${prefix}${opp}_${ts}`;
};

window.getDriveSettings = function() {
  try {
    const raw = localStorage.getItem('dunkers_gdrive_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        rosterFolderId: parsed.rosterFolderId || window.DUNKERS_CONFIG.rosterDriveFolderId,
        parentFolderId: parsed.parentFolderId || window.DUNKERS_CONFIG.googleDriveFolderId,
        appsScriptUrl: parsed.appsScriptUrl || '',
        secretKey: parsed.secretKey || '',
        googleApiKey: parsed.googleApiKey || '',
        oauthAccessToken: parsed.oauthAccessToken || ''
      };
    }
  } catch (e) {}
  return {
    rosterFolderId: window.DUNKERS_CONFIG.rosterDriveFolderId,
    parentFolderId: window.DUNKERS_CONFIG.googleDriveFolderId,
    appsScriptUrl: '',
    secretKey: '',
    googleApiKey: '',
    oauthAccessToken: ''
  };
};

window.saveDriveSettings = function(settings) {
  const merged = {
    ...window.getDriveSettings(),
    ...settings,
    rosterFolderId: settings.rosterFolderId || window.DUNKERS_CONFIG.rosterDriveFolderId,
    parentFolderId: settings.parentFolderId || window.DUNKERS_CONFIG.googleDriveFolderId
  };
  localStorage.setItem('dunkers_gdrive_settings', JSON.stringify(merged));
  return merged;
};

window.validateAppsScriptUrl = function(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes('/edit') || trimmed.includes('/d/') || trimmed.includes('/home/projects/')) {
    return 'The URL you entered ends with "/edit" (which is the script editor link).\n\nPlease click "Deploy" -> "New deployment" (or "Manage deployments") -> select "Web app", set "Who has access" to "Anyone", and copy the Web App URL ending in "/exec" (https://script.google.com/macros/s/.../exec).';
  }
  if (!trimmed.endsWith('/exec') && !trimmed.endsWith('/dev')) {
    return 'The Google Apps Script Web App URL should start with "https://script.google.com/macros/s/" and end with "/exec".';
  }
  return null;
};

window.cacheTeamsAndRostersLocally = function(rostersPayload) {
  if (!rostersPayload || !rostersPayload.teams) {
    throw new Error('Invalid teams_rosters.json structure: missing "teams" object');
  }
  window.DUNKERS_TEAMS = rostersPayload.teams;
  localStorage.setItem('dunkers_cached_teams_rosters_v1', JSON.stringify(rostersPayload));
  return rostersPayload.teams;
};

/**
 * CONNECTION #1 (Pre-Game Setup — Called ONCE at the beginning):
 * Fetches teams_rosters.json from Google Drive folder 1-GSovenRouWVnOw-L9kbSbrT061SLLT9
 */
window.fetchTeamsAndRostersFromGoogleDrive = async function(options = {}) {
  const settings = window.getDriveSettings();
  const rosterFolderId = settings.rosterFolderId || window.DUNKERS_CONFIG.rosterDriveFolderId;

  // 1. Google Apps Script Web App Bridge (Recommended)
  if (settings.appsScriptUrl && settings.appsScriptUrl.trim()) {
    const urlError = window.validateAppsScriptUrl(settings.appsScriptUrl);
    if (urlError) {
      throw new Error(urlError);
    }

    const scriptUrl = settings.appsScriptUrl.trim();
    const resp = await fetch(scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'GET_ROSTERS',
        rosterFolderId,
        secretKey: settings.secretKey || ''
      })
    });
    const result = await resp.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to load teams_rosters.json from Google Drive Apps Script');
    }
    const teams = window.cacheTeamsAndRostersLocally(result.data);
    return { source: 'GOOGLE_DRIVE_APPS_SCRIPT', teams };
  }

  // 2. Direct Google Drive REST API v3 (OAuth 2.0 Bearer Token or Google API Key)
  const hasOAuth = settings.oauthAccessToken && settings.oauthAccessToken.trim();
  const hasApiKey = settings.googleApiKey && settings.googleApiKey.trim();

  if (hasOAuth || hasApiKey) {
    const q = encodeURIComponent(`'${rosterFolderId}' in parents and name contains '.json' and trashed = false`);
    const keyParam = hasApiKey && !hasOAuth ? `&key=${encodeURIComponent(settings.googleApiKey.trim())}` : '';
    const headers = hasOAuth ? { 'Authorization': `Bearer ${settings.oauthAccessToken.trim()}` } : {};

    const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)${keyParam}`, { headers });
    if (!listResp.ok) {
      const errText = await listResp.text();
      throw new Error(`Google Drive roster lookup failed (${listResp.status}): ${errText}`);
    }
    const listData = await listResp.json();
    if (!listData.files || listData.files.length === 0) {
      throw new Error(`No roster JSON file found in Google Drive folder ${rosterFolderId}`);
    }
    const targetFile = listData.files.find(f => f.name === 'teams_rosters.json') || listData.files[0];
    const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media${keyParam}`, { headers });
    if (!fileResp.ok) {
      const errText = await fileResp.text();
      throw new Error(`Failed to download ${targetFile.name} (${fileResp.status}): ${errText}`);
    }
    const payload = await fileResp.json();
    const teams = window.cacheTeamsAndRostersLocally(payload);
    return { source: 'GOOGLE_DRIVE_API', teams };
  }

  // 3. Local Dev Fallback: Check if gitignored ./teams_rosters.json exists on local server
  if (options.allowLocalFallback !== false) {
    try {
      const localResp = await fetch('./teams_rosters.json', { cache: 'no-store' });
      if (localResp.ok) {
        const payload = await localResp.json();
        const teams = window.cacheTeamsAndRostersLocally(payload);
        return { source: 'LOCAL_FILE', teams };
      }
    } catch (e) {}
  }

  throw new Error('NEEDS_CONFIG');
};

/**
 * CONNECTION #2 (Post-Game Save — Called ONCE after the game):
 * Saves match HTML & JSON to Google Drive folder 14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1
 * inside a newly created subfolder with prefix "2026Summer_B11_DD2_" or "2026Summer_B15_DD5_" and suffix "_yyyymmddhhmmss".
 */
window.saveMatchToGoogleDrive = async function(state, htmlContent) {
  const settings = window.getDriveSettings();
  const parentFolderId = settings.parentFolderId || window.DUNKERS_CONFIG.googleDriveFolderId;
  const ts = window.getTimestampYYYYMMDDHHMMSS();
  const subfolderName = window.buildSubfolderName(state, ts);
  const htmlFilename = window.getExportHtmlFilename(state);
  const jsonFilename = `match-data-${ts}.json`;
  const jsonContent = JSON.stringify(state, null, 2);

  // Method 1: Google Apps Script Web App Bridge (Recommended)
  if (settings.appsScriptUrl && settings.appsScriptUrl.trim()) {
    const urlError = window.validateAppsScriptUrl(settings.appsScriptUrl);
    if (urlError) {
      throw new Error(urlError);
    }

    const resp = await fetch(settings.appsScriptUrl.trim(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'SAVE_MATCH',
        secretKey: settings.secretKey || '',
        parentFolderId,
        subfolderName,
        timestamp: ts,
        files: [
          { name: htmlFilename, mimeType: 'text/html', content: htmlContent },
          { name: jsonFilename, mimeType: 'application/json', content: jsonContent }
        ]
      })
    });
    const result = await resp.json();
    if (!result.ok) {
      throw new Error(result.error || 'Apps Script Bridge returned an error');
    }
    return {
      method: 'APPS_SCRIPT',
      subfolderName,
      folderUrl: result.folderUrl || `https://drive.google.com/drive/u/0/folders/${result.subfolderId || parentFolderId}`,
      htmlFileUrl: result.htmlFileUrl || null
    };
  }

  // Method 2: Direct Google Drive REST API v3 via OAuth 2.0 Bearer Token
  if (settings.oauthAccessToken && settings.oauthAccessToken.trim()) {
    const token = settings.oauthAccessToken.trim();

    const folderResp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: subfolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      })
    });

    if (!folderResp.ok) {
      const errText = await folderResp.text();
      throw new Error(`Google Drive API folder creation failed (${folderResp.status}): ${errText}`);
    }
    const folderData = await folderResp.json();
    const subfolderId = folderData.id;

    async function uploadFileToDrive(filename, mimeType, textBody) {
      const boundary = '-------dunkersDriveBoundary' + Date.now();
      const metadata = {
        name: filename,
        mimeType: mimeType,
        parents: [subfolderId]
      };
      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
        `${textBody}\r\n` +
        `--${boundary}--`;

      const upResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!upResp.ok) {
        const errText = await upResp.text();
        throw new Error(`Upload failed for ${filename} (${upResp.status}): ${errText}`);
      }
      return await upResp.json();
    }

    const htmlFile = await uploadFileToDrive(htmlFilename, 'text/html', htmlContent);
    await uploadFileToDrive(jsonFilename, 'application/json', jsonContent);

    return {
      method: 'DRIVE_API',
      subfolderName,
      subfolderId,
      folderUrl: folderData.webViewLink || `https://drive.google.com/drive/u/0/folders/${subfolderId}`,
      htmlFileUrl: htmlFile.webViewLink || null
    };
  }

  throw new Error('NEEDS_CONFIG');
};
