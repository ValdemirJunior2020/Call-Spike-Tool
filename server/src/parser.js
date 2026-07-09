import * as cheerio from 'cheerio';
import { secondsToDuration } from './time.js';

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function htmlToLooseText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|td|th|span|font|h1|h2|h3)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function getLabelNumber(text, label, fallback = 0) {
  const flexibleLabel = label
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');

  const regex = new RegExp(`${flexibleLabel}\\s*:?\\s*(\\d+)`, 'i');
  const match = String(text || '').match(regex);

  if (!match) return fallback;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

function parseSeconds(value) {
  const text = cleanText(value).toLowerCase();

  if (!text) return 0;

  const plainSeconds = text.match(/^(\d+)\s*s?$/i);
  if (plainSeconds) return Number(plainSeconds[1]);

  const minutesSeconds = text.match(/(\d+)\s*m(?:in)?\s*(\d+)?\s*s?/i);
  if (minutesSeconds) {
    return Number(minutesSeconds[1]) * 60 + Number(minutesSeconds[2] || 0);
  }

  const colon = text.match(/^(\d+):(\d{2})$/);
  if (colon) {
    return Number(colon[1]) * 60 + Number(colon[2]);
  }

  const firstNumber = text.match(/(\d+)/);
  return firstNumber ? Number(firstNumber[1]) : 0;
}

function splitNotesAndLastAction(rawNotes) {
  let notes = cleanText(rawNotes).replace(/\* \* \*.*$/i, '').trim();
  let lastAction = '';

  const lastActionMatch = notes.match(/\b(waitingQueue|dial|connectAgent|connect|sendToVoicemail|voicemail|completed|busy|failed|no-answer)$/i);

  if (lastActionMatch) {
    lastAction = lastActionMatch[1];
    notes = notes.slice(0, lastActionMatch.index).trim();
  }

  return { notes, lastAction };
}

function queueWaitSecondsFromNotes(notes) {
  const match = cleanText(notes).match(/queue wait time\s+(\d+)\s+seconds/i);
  return match ? Number(match[1]) : null;
}

function makeCallRow({
  rowNumber = 0,
  callId = '',
  duration = '',
  score = '',
  called = '',
  caller = '',
  notes = '',
  lastAction = ''
}) {
  const durationSeconds = parseSeconds(duration);
  const cleanNotes = cleanText(notes);
  const cleanLastAction = cleanText(lastAction);
  const queueWaitSeconds = queueWaitSecondsFromNotes(`${cleanNotes} ${cleanLastAction}`);

  return {
    rowNumber: Number(rowNumber) || 0,
    callId: cleanText(callId),
    duration: secondsToDuration(durationSeconds),
    durationSeconds,
    score: Number(score) || 0,
    called: cleanText(called),
    caller: cleanText(caller),
    notes: cleanNotes,
    lastAction: cleanLastAction,
    queueWaitSeconds
  };
}

function parseCallsFromHtmlTable($) {
  const calls = [];

  $('tr').each((_, tr) => {
    const cells = $(tr)
      .find('td,th')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);

    if (cells.length < 5) return;

    const callIdIndex = cells.findIndex((cell) => /\bCA[A-Za-z0-9_-]+\b/i.test(cell));
    if (callIdIndex < 0) return;

    const rowNumber = callIdIndex > 0 ? cells[callIdIndex - 1] : calls.length + 1;
    const callId = cells[callIdIndex];
    const duration = cells[callIdIndex + 1] || '';
    const score = cells[callIdIndex + 2] || '';
    const called = cells[callIdIndex + 3] || '';
    const caller = cells[callIdIndex + 4] || '';

    const remaining = cells.slice(callIdIndex + 5);
    let lastAction = '';
    let notes = remaining.join(' ');

    if (remaining.length > 1) {
      const possibleLast = remaining[remaining.length - 1];
      if (/^(waitingQueue|dial|connectAgent|connect|sendToVoicemail|voicemail|completed|busy|failed|no-answer)$/i.test(possibleLast)) {
        lastAction = possibleLast;
        notes = remaining.slice(0, -1).join(' ');
      }
    }

    calls.push(
      makeCallRow({
        rowNumber,
        callId,
        duration,
        score,
        called,
        caller,
        notes,
        lastAction
      })
    );
  });

  return calls;
}

function parseCallsFromFlatText(flat) {
  let tableText = flat;

  const headerIndex = flat.search(/Call\s*ID\s+Duration\s+Score\s+Called\s+Caller\s+Notes\s+Last\s*Action/i);

  if (headerIndex >= 0) {
    tableText = flat
      .slice(headerIndex)
      .replace(/Call\s*ID\s+Duration\s+Score\s+Called\s+Caller\s+Notes\s+Last\s*Action/i, '');
  }

  const callRowRegex =
    /(?:^|\s)(\d+)\s*(CA[A-Za-z0-9_-]+)\s+(\d+\s*s|\d+:\d{2}|\d+\s*m\s*\d*\s*s?)\s+(\d+)\s*(\+?\d{7,})\s*(\+?\d{7,})\s+([\s\S]*?)(?=\s+\d+\s*CA[A-Za-z0-9_-]+\s+|\s+\* \* \*|$)/gi;

  const calls = [];
  let match;

  while ((match = callRowRegex.exec(tableText)) !== null) {
    const { notes, lastAction } = splitNotesAndLastAction(match[7]);

    calls.push(
      makeCallRow({
        rowNumber: match[1],
        callId: match[2],
        duration: match[3],
        score: match[4],
        called: match[5],
        caller: match[6],
        notes,
        lastAction
      })
    );
  }

  return calls;
}

export function parseQueuePage(html, sourceUrl = '') {
  const $ = cheerio.load(html || '');

  const domText = cleanText($('body').text() || '');
  const looseHtmlText = cleanText(htmlToLooseText(html || ''));
  const combinedText = cleanText(`${domText} ${looseHtmlText}`);
  const flat = combinedText.replace(/\s+/g, ' ').trim();

  const startedAt =
    flat.match(/Started\s+at\s+(.+?)\s+Last\s+processed/i)?.[1]?.trim() ||
    flat.match(/Started\s+at\s+(.+?)\s+Customer\s*Service/i)?.[1]?.trim() ||
    '';

  const callsOnHold = getLabelNumber(flat, 'Customer Service Calls on Hold', 0);
  const agentsAvailable = getLabelNumber(flat, 'AgentsAvailableToTakeCall', 0);
  const callbackPromptAfterSeconds = getLabelNumber(flat, 'Call Back Prompt After', 0);
  const voicemailAfterSeconds = getLabelNumber(flat, 'Voicemail After', 0);

  let calls = parseCallsFromHtmlTable($);

  if (calls.length === 0) {
    calls = parseCallsFromFlatText(flat);
  }

  const maxDurationSeconds = calls.reduce((max, call) => Math.max(max, call.durationSeconds || 0), 0);
  const queueWaitValues = calls
    .map((call) => call.queueWaitSeconds)
    .filter((value) => Number.isFinite(value));

  const maxQueueWaitSeconds = queueWaitValues.length ? Math.max(...queueWaitValues) : 0;

  return {
    sourceUrl,
    checkedAt: new Date().toISOString(),
    startedAt,
    callsOnHold,
    agentsAvailable,
    callbackPromptAfterSeconds,
    voicemailAfterSeconds,
    maxDurationSeconds,
    maxDuration: secondsToDuration(maxDurationSeconds),
    maxQueueWaitSeconds,
    maxQueueWait: secondsToDuration(maxQueueWaitSeconds),
    calls
  };
}