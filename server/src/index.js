import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { QueueWatcher } from './watcher.js';

const config = loadConfig();
const watcher = new QueueWatcher(config);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json(watcher.getStatus());
});

app.post('/api/start', (req, res) => {
  res.json(watcher.start());
});

app.post('/api/stop', (req, res) => {
  res.json(watcher.stop());
});

app.post('/api/check', async (req, res) => {
  const status = await watcher.checkOnce();
  res.json(status);
});

app.post('/api/config', (req, res) => {
  const body = req.body || {};
  const nextConfig = {};

  const numberFields = [
    'checkIntervalSeconds',
    'alertHoldCount',
    'spikeDelta',
    'waitTimeSpikeSeconds',
    'spikeCooldownMinutes'
  ];

  for (const field of numberFields) {
    if (body[field] !== undefined) {
      const value = Number(body[field]);
      if (Number.isFinite(value) && value > 0) nextConfig[field] = value;
    }
  }

  if (body.queueUrl) nextConfig.queueUrl = String(body.queueUrl).trim();
  if (body.sheetTimezone) nextConfig.sheetTimezone = String(body.sheetTimezone).trim();
  if (body.logOnlyWaitingQueue !== undefined) nextConfig.logOnlyWaitingQueue = Boolean(body.logOnlyWaitingQueue);

  res.json(watcher.updateConfig(nextConfig));
});

app.listen(config.port, () => {
  console.log(`Call Queue Spike Monitor server running on http://localhost:${config.port}`);
  console.log('Open the React app at http://localhost:5173');

  watcher.start();

  console.log('Watcher auto-started. No need to click Start watcher.');
});