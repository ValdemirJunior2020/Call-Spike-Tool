import axios from 'axios';
import { formatDateForSheet, formatTimeForSheet } from './time.js';

export async function appendSpikeToGoogleSheet({ snapshot, detection, calls, config }) {
  if (!config.appsScriptWebAppUrl) {
    return {
      ok: false,
      skipped: true,
      message: 'APPS_SCRIPT_WEB_APP_URL is not set, so the spike was saved locally only.'
    };
  }

  const checkedAtDate = new Date(snapshot.checkedAt);
  const sheetName = formatDateForSheet(checkedAtDate, config.sheetTimezone);

  const payload = {
    action: 'appendSpike',
    token: config.sheetWebAppToken || '',
    sheetName,
    checkedAt: snapshot.checkedAt,
    checkedDate: sheetName,
    checkedTime: formatTimeForSheet(checkedAtDate, config.sheetTimezone),
    sourceUrl: snapshot.sourceUrl,
    snapshot: {
      callsOnHold: snapshot.callsOnHold,
      agentsAvailable: snapshot.agentsAvailable,
      maxDuration: snapshot.maxDuration,
      maxDurationSeconds: snapshot.maxDurationSeconds,
      maxQueueWait: snapshot.maxQueueWait,
      maxQueueWaitSeconds: snapshot.maxQueueWaitSeconds,
      callbackPromptAfterSeconds: snapshot.callbackPromptAfterSeconds,
      voicemailAfterSeconds: snapshot.voicemailAfterSeconds
    },
    spikeReason: detection.reasonText,
    rows: calls.map((call) => ({
      callId: call.callId,
      duration: call.duration,
      durationSeconds: call.durationSeconds,
      score: call.score,
      called: call.called,
      caller: call.caller,
      notes: call.notes,
      lastAction: call.lastAction,
      queueWaitSeconds: call.queueWaitSeconds
    }))
  };

  const response = await axios.post(config.appsScriptWebAppUrl, payload, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' }
  });

  return response.data;
}
