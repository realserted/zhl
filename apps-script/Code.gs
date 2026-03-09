/**
 * ZHL Google Drive File Manager — Apps Script Web App
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs
 * 3. Go to Project Settings > Script Properties and add:
 *    - API_KEY: A random secret string (generate one and share with ZHL)
 * 4. Click Deploy > New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the web app URL and API key into your ZHL project settings
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var apiKey = payload.apiKey;
    var accessToken = payload.accessToken;
    var action = payload.action;
    var params = payload.params || {};

    // Validate API key
    var expectedKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expectedKey || apiKey !== expectedKey) {
      return jsonResponse({ error: 'Invalid API key.' }, 403);
    }

    if (!accessToken) {
      return jsonResponse({ error: 'Missing access token.' }, 401);
    }

    var headers = { 'Authorization': 'Bearer ' + accessToken };

    switch (action) {
      case 'listFolder':
        return handleListFolder(headers, params);
      case 'listFolderRecursive':
        return handleListFolderRecursive(headers, params);
      case 'createFolder':
        return handleCreateFolder(headers, params);
      case 'renameFile':
        return handleRenameFile(headers, params);
      case 'moveFile':
        return handleMoveFile(headers, params);
      case 'deleteFile':
        return handleDeleteFile(headers, params);
      case 'restoreFile':
        return handleRestoreFile(headers, params);
      case 'ensureArchive':
        return handleEnsureArchive(headers, params);
      case 'getFileUrl':
        return handleGetFileUrl(headers, params);
      case 'getFolderInfo':
        return handleGetFolderInfo(headers, params);
      default:
        return jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
}

// Also support GET for health checks
function doGet() {
  return jsonResponse({ status: 'ok', service: 'ZHL Drive Manager' });
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/**
 * List files and folders in a single folder (non-recursive).
 * params: { folderId }
 */
function handleListFolder(headers, params) {
  if (!params.folderId) return jsonResponse({ error: 'Missing folderId.' }, 400);

  var query = "'" + params.folderId + "' in parents and trashed=false";
  var fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,parents)';
  var allFiles = [];
  var pageToken = null;

  do {
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(query)
      + '&fields=nextPageToken,' + encodeURIComponent(fields)
      + '&pageSize=1000'
      + '&orderBy=folder,name';

    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }

    var response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    var statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      return jsonResponse({ error: 'Drive API error', details: JSON.parse(response.getContentText()) }, statusCode);
    }

    var data = JSON.parse(response.getContentText());
    allFiles = allFiles.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return jsonResponse({ files: allFiles });
}

/**
 * List all files and folders recursively from a root folder.
 * params: { folderId }
 * Returns a flat array with parentId info for tree reconstruction.
 */
function handleListFolderRecursive(headers, params) {
  if (!params.folderId) return jsonResponse({ error: 'Missing folderId.' }, 400);

  var allItems = [];
  var queue = [params.folderId];

  while (queue.length > 0) {
    var currentFolderId = queue.shift();
    var query = "'" + currentFolderId + "' in parents and trashed=false";
    var fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,parents)';
    var pageToken = null;

    do {
      var url = 'https://www.googleapis.com/drive/v3/files'
        + '?q=' + encodeURIComponent(query)
        + '&fields=nextPageToken,' + encodeURIComponent(fields)
        + '&pageSize=1000'
        + '&orderBy=folder,name';

      if (pageToken) {
        url += '&pageToken=' + encodeURIComponent(pageToken);
      }

      var response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) {
        return jsonResponse({
          error: 'Drive API error listing folder ' + currentFolderId,
          details: JSON.parse(response.getContentText())
        }, response.getResponseCode());
      }

      var data = JSON.parse(response.getContentText());
      var files = data.files || [];

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        file.parentId = currentFolderId;
        allItems.push(file);

        // Queue subfolders for recursive traversal
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(file.id);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  return jsonResponse({ files: allItems });
}

/**
 * Create a new folder.
 * params: { name, parentId }
 */
function handleCreateFolder(headers, params) {
  if (!params.name || !params.parentId) {
    return jsonResponse({ error: 'Missing name or parentId.' }, 400);
  }

  var url = 'https://www.googleapis.com/drive/v3/files';
  var body = {
    name: params.name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [params.parentId]
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: mergeHeaders(headers, { 'Content-Type': 'application/json' }),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Rename a file or folder.
 * params: { fileId, newName }
 */
function handleRenameFile(headers, params) {
  if (!params.fileId || !params.newName) {
    return jsonResponse({ error: 'Missing fileId or newName.' }, 400);
  }

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.fileId;
  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: mergeHeaders(headers, { 'Content-Type': 'application/json' }),
    payload: JSON.stringify({ name: params.newName }),
    muteHttpExceptions: true
  });

  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Move a file or folder to a different parent.
 * params: { fileId, fromFolderId, toFolderId }
 */
function handleMoveFile(headers, params) {
  if (!params.fileId || !params.fromFolderId || !params.toFolderId) {
    return jsonResponse({ error: 'Missing fileId, fromFolderId, or toFolderId.' }, 400);
  }

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.fileId
    + '?addParents=' + encodeURIComponent(params.toFolderId)
    + '&removeParents=' + encodeURIComponent(params.fromFolderId)
    + '&fields=id,name,parents';

  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: headers,
    muteHttpExceptions: true
  });

  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Delete a file by moving it to the ARCHIVE folder.
 * params: { fileId, currentParentId, archiveFolderId }
 */
function handleDeleteFile(headers, params) {
  if (!params.fileId || !params.currentParentId || !params.archiveFolderId) {
    return jsonResponse({ error: 'Missing fileId, currentParentId, or archiveFolderId.' }, 400);
  }

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.fileId
    + '?addParents=' + encodeURIComponent(params.archiveFolderId)
    + '&removeParents=' + encodeURIComponent(params.currentParentId)
    + '&fields=id,name,parents';

  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: headers,
    muteHttpExceptions: true
  });

  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Restore a file from ARCHIVE back to a target folder.
 * params: { fileId, archiveFolderId, targetFolderId }
 */
function handleRestoreFile(headers, params) {
  if (!params.fileId || !params.archiveFolderId || !params.targetFolderId) {
    return jsonResponse({ error: 'Missing fileId, archiveFolderId, or targetFolderId.' }, 400);
  }

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.fileId
    + '?addParents=' + encodeURIComponent(params.targetFolderId)
    + '&removeParents=' + encodeURIComponent(params.archiveFolderId)
    + '&fields=id,name,parents';

  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: headers,
    muteHttpExceptions: true
  });

  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Ensure the ARCHIVE folder exists in the root folder.
 * params: { rootFolderId }
 */
function handleEnsureArchive(headers, params) {
  if (!params.rootFolderId) {
    return jsonResponse({ error: 'Missing rootFolderId.' }, 400);
  }

  // Search for existing ARCHIVE folder
  var searchQuery = "'" + params.rootFolderId + "' in parents"
    + " and name='ARCHIVE'"
    + " and mimeType='application/vnd.google-apps.folder'"
    + " and trashed=false";

  var searchUrl = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(searchQuery)
    + '&fields=files(id,name)';

  var searchResp = UrlFetchApp.fetch(searchUrl, { headers: headers, muteHttpExceptions: true });
  if (searchResp.getResponseCode() !== 200) {
    return jsonResponse({
      error: 'Failed to search for ARCHIVE folder.',
      details: JSON.parse(searchResp.getContentText())
    }, searchResp.getResponseCode());
  }

  var searchData = JSON.parse(searchResp.getContentText());
  if (searchData.files && searchData.files.length > 0) {
    return jsonResponse({ archiveFolderId: searchData.files[0].id, created: false });
  }

  // Create ARCHIVE folder
  var createUrl = 'https://www.googleapis.com/drive/v3/files';
  var createResp = UrlFetchApp.fetch(createUrl, {
    method: 'post',
    headers: mergeHeaders(headers, { 'Content-Type': 'application/json' }),
    payload: JSON.stringify({
      name: 'ARCHIVE',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [params.rootFolderId]
    }),
    muteHttpExceptions: true
  });

  if (createResp.getResponseCode() !== 200) {
    return jsonResponse({
      error: 'Failed to create ARCHIVE folder.',
      details: JSON.parse(createResp.getContentText())
    }, createResp.getResponseCode());
  }

  var created = JSON.parse(createResp.getContentText());
  return jsonResponse({ archiveFolderId: created.id, created: true });
}

/**
 * Get viewable and downloadable URLs for a file.
 * params: { fileId }
 */
function handleGetFileUrl(headers, params) {
  if (!params.fileId) return jsonResponse({ error: 'Missing fileId.' }, 400);

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.fileId
    + '?fields=id,name,webViewLink,webContentLink,mimeType';

  var response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

/**
 * Get info about a folder (used to validate a pasted Drive URL).
 * params: { folderId }
 */
function handleGetFolderInfo(headers, params) {
  if (!params.folderId) return jsonResponse({ error: 'Missing folderId.' }, 400);

  var url = 'https://www.googleapis.com/drive/v3/files/' + params.folderId
    + '?fields=id,name,mimeType,owners,shared';

  var response = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  return jsonResponse(JSON.parse(response.getContentText()), response.getResponseCode());
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function mergeHeaders(base, extra) {
  var merged = {};
  for (var k in base) merged[k] = base[k];
  for (var k in extra) merged[k] = extra[k];
  return merged;
}

function jsonResponse(data, statusCode) {
  // Apps Script doPost always returns 200 at the HTTP level.
  // We embed the actual status in the response body.
  var output = {
    status: statusCode || 200,
    data: data
  };
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}
