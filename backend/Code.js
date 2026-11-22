/**
 * Saativkei Attendance: backend entry point (Google Apps Script web app).
 * The front end sends JSON as text/plain POST (avoids CORS preflight).
 */

function routes_() {
  return {
    // Punch phone
    'device.pair': devicePair_,
    'kiosk.init': kioskInit_,
    'kiosk.punch': kioskPunch_,
    // Owner / developer
    'admin.me': adminMe_,
    'admin.day': adminDay_,
    'admin.pending': adminPending_,
    'admin.range': adminRange_,
    'admin.photo': adminPhoto_,
    'admin.correct': adminCorrect_,
    'admin.employees': adminEmployees_,
    'admin.employee.save': adminSaveEmployee_,
    'admin.face.enroll': adminEnrollFace_,
    'admin.face.delete': adminDeleteFace_,
    'admin.devices': adminDevices_,
    'admin.device.code': adminPairCode_,
    'admin.device.revoke': adminRevokeDevice_,
    'admin.settings': adminSettings_,
    'admin.settings.save': adminSaveSettings_,
    'admin.telegram.token': adminTelegramToken_,
    'admin.telegram.link': adminTelegramLink_,
    'admin.telegram.check': adminTelegramCheck_,
    'admin.telegram.test': adminTelegramTest_,
    'admin.telegram.unlink': adminTelegramUnlink_,
    'admin.admins.add': adminAddAdmin_,
    'admin.admins.remove': adminRemoveAdmin_,
    'admin.integrity': adminIntegrity_
  };
}

function doGet() {
  return json_({ ok: true, service: 'saativkei-attendance', set_up: !!prop_('SPREADSHEET_ID'), time: Date.now() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, code: 'BAD_REQUEST', message: 'Invalid request.' });
  }
  try {
    var fn = routes_()[req.action];
    if (!fn) return json_({ ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown action.' });
    return json_(fn(req));
  } catch (err) {
    if (err && err.apiCode) return json_({ ok: false, code: err.apiCode, message: err.message });
    console.error((err && err.stack) || err);
    return json_({ ok: false, code: 'SERVER_ERROR', message: 'Something went wrong on the server: ' + ((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
