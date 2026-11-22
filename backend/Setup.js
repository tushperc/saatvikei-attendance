/**
 * One-time setup. In the Apps Script editor pick "setup" and press Run.
 * Safe to run again: it only adds what is missing.
 *
 * Fill these in before the first run (or set them later in Project Settings → Script properties).
 */
var SETUP_CONFIG = {
  GOOGLE_CLIENT_ID: '',   // OAuth Web client ID used for owner sign-in (see README step 3)
  EXTRA_ADMINS: '',       // comma separated, e.g. 'owner@gmail.com'. The account running setup is always an admin.
  ADMIN_URL: 'https://tushperc.github.io/saativkei-attendance/admin.html' // e.g. 'https://<github-user>.github.io/<repo>/admin.html'
};

function setup() {
  var props = PropertiesService.getScriptProperties();
  var me = Session.getEffectiveUser().getEmail().toLowerCase();

  // Drive folders
  var folderId = props.getProperty('FOLDER_ID');
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder('Saativkei Attendance');
  props.setProperty('FOLDER_ID', folder.getId());
  var selfieId = props.getProperty('SELFIE_FOLDER_ID');
  if (!selfieId) {
    var sf = folder.createFolder('Selfies');
    sf.setDescription('Punch selfies saved by the Saativkei attendance system. One sub-folder per month. Safe to delete old months to free space; punch records stay in the Sheet.');
    props.setProperty('SELFIE_FOLDER_ID', sf.getId());
  }

  // Spreadsheet
  var ssId = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('Saativkei Attendance');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  _ssCache = ss;

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SCHEMA[name];
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1efe8');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // Settings defaults
  var existing = readObjects_(SHEET.SET).map(function (r) { return r.key; });
  SETTING_DEFAULTS.forEach(function (d) {
    if (existing.indexOf(d[0]) < 0) appendObject_(SHEET.SET, { key: d[0], value: d[0] === 'admin_url' ? SETUP_CONFIG.ADMIN_URL : d[1], description: d[2] });
  });
  if (SETUP_CONFIG.ADMIN_URL) saveSettings_({ admin_url: SETUP_CONFIG.ADMIN_URL });

  // Protect evidence tabs: only the owner (the account running the script) can edit them.
  CHAINED.concat(['Faces', 'Devices']).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect();
    prot.setDescription('Written only by the attendance system. Changes here break the integrity check.');
    prot.removeEditors(prot.getEditors());
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  });
  ss.getSheetByName('Faces').hideSheet();
  ss.setActiveSheet(ss.getSheetByName('Daily'));

  // Admins and sign-in
  var admins = (props.getProperty('ADMIN_EMAILS') || '').split(',').concat([me]).concat(SETUP_CONFIG.EXTRA_ADMINS.split(','))
    .map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  props.setProperty('ADMIN_EMAILS', admins.filter(function (x, i) { return admins.indexOf(x) === i; }).join(','));
  if (SETUP_CONFIG.GOOGLE_CLIENT_ID) props.setProperty('GOOGLE_CLIENT_ID', SETUP_CONFIG.GOOGLE_CLIENT_ID);

  // 5-minute timer
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();

  console.log('✅ Setup done.\nSheet: ' + ss.getUrl() + '\nFolder: ' + folder.getUrl() +
    '\nAdmins: ' + props.getProperty('ADMIN_EMAILS') + '\nGoogle client ID set: ' + !!props.getProperty('GOOGLE_CLIENT_ID'));
}

/** Handy for testing from the editor: shows today's summary in the log without sending it. */
function previewTodaySummary() {
  console.log(daySummaryText_(istParts_(Date.now()).date));
}
