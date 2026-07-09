// Paste this into the Google Sheet's Apps Script editor:
// Extensions > Apps Script > replace Code.gs with this file.
// Then Deploy > New deployment > Web app.
// Execute as: Me. Who has access: Anyone with the link.

const SPREADSHEET_ID = '10L2ZZaVDsLHD0i_iSwtx2ItMJroGQ6-LXyr2TU1itKg';
const TIMEZONE = 'America/New_York';

// Optional security. If you set this, put the same value in .env as SHEET_WEB_APP_TOKEN.
const SECRET_TOKEN = '';

const HEADERS = [
  'Logged At',
  'Issue Date',
  'Issue Time',
  'Calls On Hold',
  'Agents Available',
  'Spike Reason',
  'Call ID',
  'Duration',
  'Score',
  'Called',
  'Caller',
  'Notes',
  'Last Action',
  'Queue Wait Seconds',
  'Source URL'
];

function doGet() {
  return json_({ ok: true, message: 'Call Queue Spike Monitor Apps Script is live.' });
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(body);

    if (SECRET_TOKEN && payload.token !== SECRET_TOKEN) {
      return json_({ ok: false, error: 'Unauthorized token.' });
    }

    if (payload.action !== 'appendSpike') {
      return json_({ ok: false, error: 'Unknown action.' });
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = safeSheetName_(payload.sheetName || formatDate_(new Date(), 'yyyy-MM-dd'));
    const sheet = getOrCreateSheet_(spreadsheet, sheetName);

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) {
      return json_({ ok: true, sheetName, appendedRows: 0, message: 'No rows were sent.' });
    }

    const checkedAt = payload.checkedAt ? new Date(payload.checkedAt) : new Date();
    const issueDate = payload.checkedDate || formatDate_(checkedAt, 'yyyy-MM-dd');
    const issueTime = payload.checkedTime || formatDate_(checkedAt, 'hh:mm:ss a');
    const snapshot = payload.snapshot || {};

    const values = rows.map((row) => [
      new Date(),
      issueDate,
      issueTime,
      snapshot.callsOnHold || '',
      snapshot.agentsAvailable || '',
      payload.spikeReason || '',
      row.callId || '',
      row.duration || '',
      row.score || '',
      row.called || '',
      row.caller || '',
      row.notes || '',
      row.lastAction || '',
      row.queueWaitSeconds || '',
      payload.sourceUrl || ''
    ]);

    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, HEADERS.length).setValues(values);
    sheet.autoResizeColumns(1, HEADERS.length);

    return json_({ ok: true, sheetName, appendedRows: values.length });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.stack ? error.stack : error) });
  }
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeaders = firstRow.some((value) => value !== '');
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }

  return sheet;
}

function safeSheetName_(name) {
  const cleaned = String(name).replace(/[\\/?*\[\]:]/g, '-').slice(0, 90).trim();
  return cleaned || formatDate_(new Date(), 'yyyy-MM-dd');
}

function formatDate_(date, pattern) {
  return Utilities.formatDate(date, TIMEZONE, pattern);
}

function json_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}
