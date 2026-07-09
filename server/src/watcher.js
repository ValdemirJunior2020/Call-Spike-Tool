import EventEmitter from 'events';
import axios from 'axios';
import { parseQueuePage } from './parser.js';
import { detectSpike, shouldLogCall } from './spikeDetector.js';
import { appendSpikeToGoogleSheet } from './sheetsClient.js';
import { Storage } from './storage.js';
import { formatDateForSheet } from './time.js';

const ONGOING_SPIKE_LOG_EVERY_SECONDS = 60;
const DAILY_ROW_LIMIT = 500;
const RESUME_HOUR = 5;

function makeSummaryCall(snapshot, reason = '') {
  return {
    rowNumber: 0,
    callId: `SUMMARY-${snapshot.checkedAt}`,
    duration: '',
    durationSeconds: 0,
    score: '',
    called: '',
    caller: '',
    notes: `Queue issue summary. Calls on hold: ${snapshot.callsOnHold}. Agents available: ${snapshot.agentsAvailable}. ${reason}`,
    lastAction: 'summary',
    queueWaitSeconds: ''
  };
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function makeZonedDate(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let date = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));

  date = new Date(utcGuess - getTimeZoneOffsetMs(date, timeZone));

  return date;
}

function getTomorrowAt5AM(timeZone) {
  const now = new Date();
  const today = getZonedParts(now, timeZone);

  const tomorrowProbe = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 0, 0));
  const tomorrow = getZonedParts(tomorrowProbe, timeZone);

  return makeZonedDate(
    tomorrow.year,
    tomorrow.month,
    tomorrow.day,
    RESUME_HOUR,
    0,
    0,
    timeZone
  );
}

function getSavedRowCount(sheetResult, fallbackRows) {
  if (sheetResult && Number.isFinite(Number(sheetResult.summaryRowsSaved))) {
    return Number(sheetResult.summaryRowsSaved);
  }

  if (sheetResult && Number.isFinite(Number(sheetResult.rowsSaved))) {
    return Number(sheetResult.rowsSaved);
  }

  return Math.max(1, Number(fallbackRows || 1));
}

function shouldSaveSmartSpike(snapshot, detection, storage, config) {
  const lastLogged = storage.state.lastLoggedSpikeSnapshot || null;

  if (!lastLogged) {
    return {
      shouldSave: true,
      reason: 'New spike started'
    };
  }

  const now = new Date(snapshot.checkedAt).getTime();
  const last = new Date(lastLogged.checkedAt).getTime();
  const secondsSinceLastLog = Math.floor((now - last) / 1000);

  const currentHold = Number(snapshot.callsOnHold || 0);
  const previousLoggedHold = Number(lastLogged.callsOnHold || 0);

  const currentAgents = Number(snapshot.agentsAvailable || 0);
  const previousLoggedAgents = Number(lastLogged.agentsAvailable || 0);

  const holdChange = Math.abs(currentHold - previousLoggedHold);
  const agentsChange = Math.abs(currentAgents - previousLoggedAgents);

  if (holdChange >= config.spikeDelta) {
    return {
      shouldSave: true,
      reason: `Queue changed a lot since last saved log. Hold count changed by ${holdChange}`
    };
  }

  if (agentsChange >= 5) {
    return {
      shouldSave: true,
      reason: `Agent availability changed a lot since last saved log. Agents changed by ${agentsChange}`
    };
  }

  if (secondsSinceLastLog >= ONGOING_SPIKE_LOG_EVERY_SECONDS) {
    return {
      shouldSave: true,
      reason: `Ongoing spike still active after ${secondsSinceLastLog} seconds`
    };
  }

  return {
    shouldSave: false,
    reason: `Spike already saved recently. Next ongoing update will save after ${ONGOING_SPIKE_LOG_EVERY_SECONDS} seconds unless it gets worse first`
  };
}

export class QueueWatcher extends EventEmitter {
  constructor(config) {
    super();
    this.config = { ...config };
    this.storage = new Storage(config.dataDir);
    this.timer = null;
    this.resumeTimer = null;
    this.isChecking = false;
    this.lastError = null;

    this.scheduleResumeIfNeeded();
  }

  getTodaySheetName() {
    return formatDateForSheet(new Date(), this.config.sheetTimezone);
  }

  getDailySavedRows(sheetName) {
    this.storage.state.dailySavedRowsByDate ||= {};
    return Number(this.storage.state.dailySavedRowsByDate[sheetName] || 0);
  }

  addDailySavedRows(sheetName, rows) {
    this.storage.state.dailySavedRowsByDate ||= {};
    const current = Number(this.storage.state.dailySavedRowsByDate[sheetName] || 0);
    const next = current + Number(rows || 0);

    this.storage.state.dailySavedRowsByDate[sheetName] = next;
    this.storage.saveState();

    return next;
  }

  clearPauseIfExpired() {
    const pausedUntil = this.storage.state.rowLimitPausedUntil;

    if (!pausedUntil) return false;

    const pauseTime = new Date(pausedUntil).getTime();

    if (Date.now() < pauseTime) return false;

    this.storage.state.rowLimitPausedUntil = null;
    this.storage.state.running = false;
    this.storage.saveState();

    return true;
  }

  scheduleResumeIfNeeded() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }

    const pausedUntil = this.storage.state.rowLimitPausedUntil;

    if (!pausedUntil) return;

    const resumeAt = new Date(pausedUntil).getTime();
    const waitMs = resumeAt - Date.now();

    if (waitMs <= 0) {
      this.storage.state.rowLimitPausedUntil = null;
      this.storage.state.running = false;
      this.storage.saveState();
      this.start();
      return;
    }

    this.resumeTimer = setTimeout(() => {
      this.storage.state.rowLimitPausedUntil = null;
      this.storage.state.running = false;
      this.storage.saveState();
      this.start();
    }, waitMs);
  }

  pauseUntilTomorrowAt5() {
    const resumeAt = getTomorrowAt5AM(this.config.sheetTimezone);

    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    this.storage.state.running = false;
    this.storage.state.rowLimitPausedUntil = resumeAt.toISOString();
    this.storage.saveState();

    this.scheduleResumeIfNeeded();

    return resumeAt;
  }

  start() {
    this.clearPauseIfExpired();

    const pausedUntil = this.storage.state.rowLimitPausedUntil;

    if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) {
      this.scheduleResumeIfNeeded();
      return this.getStatus();
    }

    if (this.timer) return this.getStatus();

    this.storage.state.running = true;
    this.storage.saveState();

    this.checkOnce().catch(() => {});

    this.timer = setInterval(() => {
      this.checkOnce().catch(() => {});
    }, this.config.checkIntervalSeconds * 1000);

    return this.getStatus();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    this.storage.state.running = false;
    this.storage.saveState();

    return this.getStatus();
  }

  updateConfig(nextConfig) {
    const wasRunning = Boolean(this.timer);

    if (wasRunning) this.stop();

    this.config = { ...this.config, ...nextConfig };

    if (wasRunning) this.start();

    return this.getStatus();
  }

  getStatus() {
    const todaySheetName = this.getTodaySheetName();

    return {
      running: Boolean(this.timer),
      checking: this.isChecking,
      lastError: this.lastError,
      rowLimitPausedUntil: this.storage.state.rowLimitPausedUntil || null,
      dailySavedRows: this.getDailySavedRows(todaySheetName),
      dailyRowLimit: DAILY_ROW_LIMIT,
      config: {
        queueUrl: this.config.queueUrl,
        checkIntervalSeconds: this.config.checkIntervalSeconds,
        alertHoldCount: this.config.alertHoldCount,
        spikeDelta: this.config.spikeDelta,
        waitTimeSpikeSeconds: this.config.waitTimeSpikeSeconds,
        spikeCooldownMinutes: this.config.spikeCooldownMinutes,
        logOnlyWaitingQueue: this.config.logOnlyWaitingQueue,
        googleSheetUrl: this.config.googleSheetUrl,
        hasAppsScriptWebAppUrl: Boolean(this.config.appsScriptWebAppUrl),
        sheetTimezone: this.config.sheetTimezone
      },
      lastSnapshot: this.storage.state.lastSnapshot,
      previousSnapshot: this.storage.state.previousSnapshot,
      lastSpikeAt: this.storage.state.lastSpikeAt,
      lastSheetResult: this.storage.state.lastSheetResult,
      lastLoggedSpikeSnapshot: this.storage.state.lastLoggedSpikeSnapshot || null,
      recentEvents: this.storage.state.recentEvents || []
    };
  }

  async fetchSnapshot() {
    const response = await axios.get(this.config.queueUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 CallQueueSpikeMonitor/1.0'
      }
    });

    return parseQueuePage(response.data, this.config.queueUrl);
  }

  async checkOnce() {
    if (this.isChecking) return this.getStatus();

    this.clearPauseIfExpired();

    const pausedUntil = this.storage.state.rowLimitPausedUntil;

    if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) {
      this.scheduleResumeIfNeeded();
      return this.getStatus();
    }

    this.isChecking = true;
    this.lastError = null;

    try {
      const snapshot = await this.fetchSnapshot();
      const previousSnapshot = this.storage.state.lastSnapshot || this.storage.getPreviousSnapshot();
      const detection = detectSpike(snapshot, previousSnapshot, this.config);

      this.storage.setLastSnapshot(snapshot);

      const event = {
        type: detection.isSpike ? 'spike-check' : 'normal-check',
        checkedAt: snapshot.checkedAt,
        callsOnHold: snapshot.callsOnHold,
        agentsAvailable: snapshot.agentsAvailable,
        maxQueueWaitSeconds: snapshot.maxQueueWaitSeconds,
        spike: detection.isSpike,
        reason: detection.reasonText || 'No spike detected',
        loggedRows: 0
      };

      const sheetName = formatDateForSheet(new Date(snapshot.checkedAt), this.config.sheetTimezone);
      const alreadySavedToday = this.getDailySavedRows(sheetName);

      if (alreadySavedToday >= DAILY_ROW_LIMIT) {
        const resumeAt = this.pauseUntilTomorrowAt5();

        event.type = 'daily-row-limit-paused';
        event.reason = `Daily row limit reached (${alreadySavedToday}/${DAILY_ROW_LIMIT}). Watcher paused until ${resumeAt.toLocaleString()}.`;

        this.storage.appendRecentEvent(event);
        this.emit('status', this.getStatus());

        return this.getStatus();
      }

      if (detection.isSpike) {
        const smartDecision = shouldSaveSmartSpike(snapshot, detection, this.storage, this.config);

        if (!smartDecision.shouldSave) {
          event.type = 'spike-recently-saved-skipped';
          event.reason = `${detection.reasonText} | ${smartDecision.reason}`;
        } else {
          const visibleCalls = snapshot.calls.length
            ? snapshot.calls.filter((call) => shouldLogCall(call, this.config))
            : [];

          let callsToLog = visibleCalls.filter((call) => {
            return call.callId && !this.storage.hasLoggedCallId(sheetName, call.callId);
          });

          if (callsToLog.length === 0) {
            callsToLog = [makeSummaryCall(snapshot, smartDecision.reason)];
          }

          const localResult = this.storage.appendLocalSpikeRows(sheetName, snapshot, detection, callsToLog);

          let sheetResult;

          try {
            sheetResult = await appendSpikeToGoogleSheet({
              snapshot,
              detection,
              calls: callsToLog,
              config: this.config
            });
          } catch (error) {
            sheetResult = {
              ok: false,
              error: error.response?.data || error.message || String(error)
            };
          }

          this.storage.markLogged(sheetName, callsToLog);
          this.storage.setLastSpikeAt(snapshot.checkedAt);
          this.storage.setLastSheetResult(sheetResult);

          const savedRows = getSavedRowCount(sheetResult, callsToLog.length);
          const dailyTotal = this.addDailySavedRows(sheetName, savedRows);

          this.storage.state.lastLoggedSpikeSnapshot = {
            checkedAt: snapshot.checkedAt,
            callsOnHold: snapshot.callsOnHold,
            agentsAvailable: snapshot.agentsAvailable,
            reason: detection.reasonText
          };
          this.storage.saveState();

          event.type = 'spike-logged';
          event.reason = `${detection.reasonText} | ${smartDecision.reason}`;
          event.loggedRows = savedRows;
          event.dailySavedRows = dailyTotal;
          event.localBackup = localResult;
          event.sheetResult = sheetResult;

          if (dailyTotal >= DAILY_ROW_LIMIT) {
            const resumeAt = this.pauseUntilTomorrowAt5();

            event.type = 'spike-logged-row-limit-paused';
            event.reason = `${event.reason} | Daily row limit reached (${dailyTotal}/${DAILY_ROW_LIMIT}). Watcher paused until ${resumeAt.toLocaleString()}.`;
          }
        }
      } else {
        this.storage.state.lastLoggedSpikeSnapshot = null;
        this.storage.saveState();
      }

      this.storage.appendRecentEvent(event);
      this.emit('status', this.getStatus());

      return this.getStatus();
    } catch (error) {
      this.lastError = error.message || String(error);

      this.storage.appendRecentEvent({
        type: 'error',
        checkedAt: new Date().toISOString(),
        error: this.lastError
      });

      this.emit('status', this.getStatus());

      return this.getStatus();
    } finally {
      this.isChecking = false;
    }
  }
}