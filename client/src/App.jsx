import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

function formatDateTime(value) {
  if (!value) return 'Not checked yet';
  return new Date(value).toLocaleString();
}

function MetricCard({ label, value, detail }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? '-'}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}

function RecentEvents({ events }) {
  if (!events?.length) {
    return <p className="empty">No checks yet. Start the watcher or click “Check now”.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Status</th>
            <th>Calls on hold</th>
            <th>Agents</th>
            <th>Rows saved</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 25).map((event, index) => (
            <tr key={`${event.checkedAt}-${index}`} className={event.spike ? 'spike-row' : ''}>
              <td>{formatDateTime(event.checkedAt)}</td>
              <td>{event.type}</td>
              <td>{event.callsOnHold ?? '-'}</td>
              <td>{event.agentsAvailable ?? '-'}</td>
              <td>{event.loggedRows ?? 0}</td>
              <td>{event.reason || event.error || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigForm({ status, onSave }) {
  const config = status?.config || {};
  const [form, setForm] = useState(config);

  useEffect(() => {
    setForm(config);
  }, [JSON.stringify(config)]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    await onSave({
      queueUrl: form.queueUrl,
      checkIntervalSeconds: Number(form.checkIntervalSeconds),
      alertHoldCount: Number(form.alertHoldCount),
      spikeDelta: Number(form.spikeDelta),
      waitTimeSpikeSeconds: Number(form.waitTimeSpikeSeconds),
      spikeCooldownMinutes: Number(form.spikeCooldownMinutes),
      logOnlyWaitingQueue: Boolean(form.logOnlyWaitingQueue),
      sheetTimezone: form.sheetTimezone
    });
  }

  return (
    <form className="config-form" onSubmit={submit}>
      <label>
        Queue page
        <input value={form.queueUrl || ''} onChange={(event) => update('queueUrl', event.target.value)} />
      </label>

      <div className="grid-fields">
        <label>
          Check every seconds
          <input type="number" min="5" value={form.checkIntervalSeconds || 30} onChange={(event) => update('checkIntervalSeconds', event.target.value)} />
        </label>
        <label>
          Hold count threshold
          <input type="number" min="1" value={form.alertHoldCount || 10} onChange={(event) => update('alertHoldCount', event.target.value)} />
        </label>
        <label>
          Sudden jump threshold
          <input type="number" min="1" value={form.spikeDelta || 5} onChange={(event) => update('spikeDelta', event.target.value)} />
        </label>
        <label>
          Long wait threshold seconds
          <input type="number" min="1" value={form.waitTimeSpikeSeconds || 300} onChange={(event) => update('waitTimeSpikeSeconds', event.target.value)} />
        </label>
        <label>
          Cooldown minutes
          <input type="number" min="1" value={form.spikeCooldownMinutes || 10} onChange={(event) => update('spikeCooldownMinutes', event.target.value)} />
        </label>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={Boolean(form.logOnlyWaitingQueue)} onChange={(event) => update('logOnlyWaitingQueue', event.target.checked)} />
        Only save calls that look like they are waiting in queue
      </label>

      <button className="secondary" type="submit">Save watcher settings</button>
    </form>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const nextStatus = await api.status();
    setStatus(nextStatus);
  }

  async function runAction(action, successMessage) {
    setBusy(true);
    setMessage('');
    try {
      const nextStatus = await action();
      setStatus(nextStatus);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message || String(error)));
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const snapshot = status?.lastSnapshot;
  const sheetReady = status?.config?.hasAppsScriptWebAppUrl;
  const danger = snapshot && snapshot.callsOnHold >= status?.config?.alertHoldCount;

  const topCalls = useMemo(() => {
    return [...(snapshot?.calls || [])]
      .sort((a, b) => (b.queueWaitSeconds || b.durationSeconds || 0) - (a.queueWaitSeconds || a.durationSeconds || 0))
      .slice(0, 10);
  }, [snapshot]);

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Local watcher</p>
          <h1>Call Queue Spike Monitor</h1>
          <p className="subtitle">Watches the HotelPlanner queue page, detects spikes, and saves spike rows to Google Sheets by date tab.</p>
        </div>
        <div className={`status-pill ${status?.running ? 'running' : 'stopped'}`}>
  {status?.running ? (
    <div className="running-gif-wrap">
      <img
        className="running-gif"
        src="https://cdn.dribbble.com/userupload/36985713/file/original-928df127afa7576e5ac3f6bb396577e0.gif"
        alt="Running"
      />
      <span>Watching</span>
    </div>
  ) : (
    'Stopped'
  )}
</div>
      </header>

      <section className="actions-card">
        <button disabled={busy || status?.running} onClick={() => runAction(api.start, 'Watcher started.')}>Start watcher</button>
        <button disabled={busy || !status?.running} onClick={() => runAction(api.stop, 'Watcher stopped.')}>Stop watcher</button>
        <button disabled={busy} className="secondary" onClick={() => runAction(api.check, 'Checked the queue once.')}>Check now</button>
        {status?.config?.googleSheetUrl ? (
          <a className="sheet-link" href={status.config.googleSheetUrl} target="_blank" rel="noreferrer">Open Google Sheet</a>
        ) : null}
      </section>

      {message ? <div className="message">{message}</div> : null}
      {status?.lastError ? <div className="error">Last error: {status.lastError}</div> : null}

      <section className="metrics">
        <MetricCard label="Calls on hold" value={snapshot?.callsOnHold} detail={danger ? 'Above your threshold' : 'Current count'} />
        <MetricCard label="Agents available" value={snapshot?.agentsAvailable} />
        <MetricCard label="Max queue wait" value={snapshot?.maxQueueWait || '-'} detail={`${snapshot?.maxQueueWaitSeconds || 0}s`} />
        <MetricCard label="Last check" value={formatDateTime(snapshot?.checkedAt)} />
      </section>

      <section className="panel two-col">
        <div>
          <h2>Watcher settings</h2>
          <ConfigForm status={status} onSave={(config) => runAction(() => api.saveConfig(config), 'Settings saved.')} />
        </div>
        <div>
          <h2>Google Sheet setup</h2>
          <p className={sheetReady ? 'good' : 'warn'}>
            {sheetReady ? 'Apps Script Web App URL is set. Spikes will be sent to Google Sheets.' : 'Apps Script Web App URL is missing. Spikes are being saved locally in the data folder only.'}
          </p>
          <p>The sheet tabs are created automatically with names like <strong>2026-07-08</strong> when a spike is logged.</p>
          <p>Local backup files are saved in the <strong>data</strong> folder even when Google Sheets works.</p>
        </div>
      </section>

      <section className="panel">
        <h2>Longest waits right now</h2>
        {!topCalls.length ? <p className="empty">No call rows parsed yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Call ID</th>
                  <th>Duration</th>
                  <th>Score</th>
                  <th>Called</th>
                  <th>Caller</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {topCalls.map((call) => (
                  <tr key={call.callId}>
                    <td>{call.callId}</td>
                    <td>{call.duration}</td>
                    <td>{call.score}</td>
                    <td>{call.called}</td>
                    <td>{call.caller}</td>
                    <td>{call.notes} {call.lastAction ? `(${call.lastAction})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recent checks and spike logs</h2>
        <RecentEvents events={status?.recentEvents || []} />
      </section>
    </main>
  );
}
