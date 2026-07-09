import fs from 'fs';
import path from 'path';

const DEFAULT_STATE = {
  running: false,
  previousSnapshot: null,
  lastSnapshot: null,
  lastSpikeAt: null,
  lastSheetResult: null,
  loggedCallIdsByDate: {},
  recentEvents: []
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export class Storage {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    ensureDir(this.dataDir);
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return { ...DEFAULT_STATE, ...parsed };
    } catch (error) {
      return { ...DEFAULT_STATE };
    }
  }

  saveState() {
    ensureDir(this.dataDir);
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  setLastSnapshot(snapshot) {
    this.state.previousSnapshot = this.state.lastSnapshot;
    this.state.lastSnapshot = snapshot;
    this.saveState();
  }

  getPreviousSnapshot() {
    return this.state.previousSnapshot;
  }

  hasLoggedCallId(sheetName, callId) {
    const set = new Set(this.state.loggedCallIdsByDate[sheetName] || []);
    return set.has(callId);
  }

  markLogged(sheetName, calls) {
    const existing = new Set(this.state.loggedCallIdsByDate[sheetName] || []);
    for (const call of calls) {
      if (call.callId) existing.add(call.callId);
    }
    this.state.loggedCallIdsByDate[sheetName] = [...existing].slice(-5000);
    this.saveState();
  }

  setLastSpikeAt(isoString) {
    this.state.lastSpikeAt = isoString;
    this.saveState();
  }

  setLastSheetResult(result) {
    this.state.lastSheetResult = result;
    this.saveState();
  }

  appendRecentEvent(event) {
    this.state.recentEvents = [event, ...(this.state.recentEvents || [])].slice(0, 100);
    this.saveState();
  }

  appendLocalSpikeRows(sheetName, snapshot, detection, calls) {
    ensureDir(this.dataDir);
    const jsonlPath = path.join(this.dataDir, `spikes-${sheetName}.jsonl`);
    const csvPath = path.join(this.dataDir, `spikes-${sheetName}.csv`);

    const rows = calls.map((call) => ({
      loggedAt: new Date().toISOString(),
      checkedAt: snapshot.checkedAt,
      sheetName,
      callsOnHold: snapshot.callsOnHold,
      agentsAvailable: snapshot.agentsAvailable,
      spikeReason: detection.reasonText,
      callId: call.callId,
      duration: call.duration,
      durationSeconds: call.durationSeconds,
      score: call.score,
      called: call.called,
      caller: call.caller,
      notes: call.notes,
      lastAction: call.lastAction,
      queueWaitSeconds: call.queueWaitSeconds,
      sourceUrl: snapshot.sourceUrl
    }));

    for (const row of rows) {
      fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
    }

    const headers = [
      'Logged At', 'Checked At', 'Calls On Hold', 'Agents Available', 'Spike Reason',
      'Call ID', 'Duration', 'Score', 'Called', 'Caller', 'Notes', 'Last Action',
      'Queue Wait Seconds', 'Source URL'
    ];

    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, `${headers.map(csvValue).join(',')}\n`);
    }

    for (const row of rows) {
      const values = [
        row.loggedAt,
        row.checkedAt,
        row.callsOnHold,
        row.agentsAvailable,
        row.spikeReason,
        row.callId,
        row.duration,
        row.score,
        row.called,
        row.caller,
        row.notes,
        row.lastAction,
        row.queueWaitSeconds,
        row.sourceUrl
      ];
      fs.appendFileSync(csvPath, `${values.map(csvValue).join(',')}\n`);
    }

    return { jsonlPath, csvPath, count: rows.length };
  }
}
