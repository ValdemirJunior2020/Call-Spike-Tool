import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(process.cwd(), '..', '..', '.env')
];

const envPath = possibleEnvPaths.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

export function loadConfig() {
  const projectRoot = envPath ? path.dirname(envPath) : process.cwd();
  return {
    port: numberFromEnv('PORT', 5050),
    queueUrl: process.env.QUEUE_URL || 'https://www.hotelplanner.com/common/schedtasks/ProcessSupportCallQueue.htm?readOnly=1',
    checkIntervalSeconds: Math.max(5, numberFromEnv('CHECK_INTERVAL_SECONDS', 30)),
    alertHoldCount: Math.max(1, numberFromEnv('ALERT_HOLD_COUNT', 10)),
    spikeDelta: Math.max(1, numberFromEnv('SPIKE_DELTA', 5)),
    waitTimeSpikeSeconds: Math.max(1, numberFromEnv('WAIT_TIME_SPIKE_SECONDS', 300)),
    spikeCooldownMinutes: Math.max(1, numberFromEnv('SPIKE_COOLDOWN_MINUTES', 10)),
    logOnlyWaitingQueue: booleanFromEnv('LOG_ONLY_WAITING_QUEUE', false),
    appsScriptWebAppUrl: process.env.APPS_SCRIPT_WEB_APP_URL || '',
    sheetWebAppToken: process.env.SHEET_WEB_APP_TOKEN || '',
    googleSheetUrl: process.env.GOOGLE_SHEET_URL || 'https://docs.google.com/spreadsheets/d/10L2ZZaVDsLHD0i_iSwtx2ItMJroGQ6-LXyr2TU1itKg/edit?usp=sharing',
    sheetTimezone: process.env.SHEET_TIMEZONE || 'America/New_York',
    dataDir: path.resolve(projectRoot, 'data')
  };
}
