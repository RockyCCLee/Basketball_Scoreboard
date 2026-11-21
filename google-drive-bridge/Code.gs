/**
 * Google Apps Script Bridge for Basketball Scoreboard
 *
 * Folder 1 (Private Team & Player Rosters): 1-GSovenRouWVnOw-L9kbSbrT061SLLT9
 *   -> Contains "teams_rosters.json" (loaded ONCE at Pre-Game Setup)
 *
 * Folder 2 (Saved Match Results & Box Scores): 14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1
 *   -> Creates subfolder "2026Summer_B11_DD2_<Opponent>_<yyyymmddhhmmss>"
 *      or "2026Summer_B15_DD5_<Opponent>_<yyyymmddhhmmss>" (saved ONCE after the game)
 *
 * IMPORTANT: Use the Deployed Web App URL ending in "/exec" (NOT the "/edit" link):
 *   https://script.google.com/macros/s/AKfycb.../exec
 */

var ROSTER_FOLDER_ID = '1-GSovenRouWVnOw-L9kbSbrT061SLLT9';
var RESULTS_FOLDER_ID = '14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1';
var SECRET_KEY = ''; // Optional: Set a secret key here (e.g. 'dunkers2026') and enter the same key in the app

function loadRosterFromFolder(rFolderId) {
  var rFolder = DriveApp.getFolderById(rFolderId || ROSTER_FOLDER_ID);
  var exactFiles = rFolder.getFilesByName('teams_rosters.json');
  var file = null;

  if (exactFiles.hasNext()) {
    file = exactFiles.next();
  } else {
    // Fallback: pick any .json file in the roster folder
    var allFiles = rFolder.getFiles();
    while (allFiles.hasNext()) {
      var candidate = allFiles.next();
      if (candidate.getName().toLowerCase().indexOf('.json') !== -1) {
        file = candidate;
        break;
      }
    }
  }

  if (!file) {
    throw new Error('No teams_rosters.json (or .json) file found in Google Drive folder ' + (rFolderId || ROSTER_FOLDER_ID));
  }

  var content = file.getBlob().getDataAsString('UTF-8');
  return JSON.parse(content);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    if (SECRET_KEY && payload.secretKey !== SECRET_KEY) {
      return jsonResponse({ ok: false, error: 'Invalid Secret Key' });
    }

    // CONNECTION #1: Pre-Game Setup — Read teams_rosters.json from 1-GSovenRouWVnOw-L9kbSbrT061SLLT9
    if (payload.action === 'GET_ROSTERS') {
      var parsed = loadRosterFromFolder(payload.rosterFolderId || ROSTER_FOLDER_ID);
      return jsonResponse({
        ok: true,
        data: parsed
      });
    }

    // CONNECTION #2: Post-Game Save — Create timestamped folder & save HTML + JSON in 14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1
    if (payload.action === 'SAVE_MATCH') {
      var parentId = payload.parentFolderId || RESULTS_FOLDER_ID;
      var parentFolder = DriveApp.getFolderById(parentId);
      var subfolderName = payload.subfolderName || ('Match_' + payload.timestamp);
      var subfolder = parentFolder.createFolder(subfolderName);

      var htmlFileUrl = '';
      var uploadFiles = payload.files || [];
      for (var i = 0; i < uploadFiles.length; i++) {
        var f = uploadFiles[i];
        var created = subfolder.createFile(f.name, f.content, f.mimeType || 'text/plain');
        if (f.name.indexOf('.html') !== -1) {
          htmlFileUrl = created.getUrl();
        }
      }

      return jsonResponse({
        ok: true,
        subfolderId: subfolder.getId(),
        subfolderName: subfolder.getName(),
        folderUrl: subfolder.getUrl(),
        htmlFileUrl: htmlFileUrl
      });
    }

    return jsonResponse({ ok: false, error: 'Unknown action: ' + payload.action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'GET_ROSTERS') {
      if (SECRET_KEY && e.parameter.secretKey !== SECRET_KEY) {
        return jsonResponse({ ok: false, error: 'Invalid Secret Key' });
      }
      var parsed = loadRosterFromFolder(e.parameter.rosterFolderId || ROSTER_FOLDER_ID);
      return jsonResponse({ ok: true, data: parsed });
    }
    return jsonResponse({
      ok: true,
      status: 'Basketball Scoreboard Google Drive Bridge is active',
      rosterFolderId: ROSTER_FOLDER_ID,
      resultsFolderId: RESULTS_FOLDER_ID
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
