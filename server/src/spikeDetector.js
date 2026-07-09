export function detectSpike(snapshot, previousSnapshot, config) {
  const reasons = [];

  const holdCount = Number(snapshot.callsOnHold || 0);
  const agentsAvailable = Number(snapshot.agentsAvailable || 0);
  const previousHoldCount = previousSnapshot ? Number(previousSnapshot.callsOnHold || 0) : null;
  const maxQueueWaitSeconds = Number(snapshot.maxQueueWaitSeconds || 0);

  const holdThreshold = Number(config.alertHoldCount || 10);
  const jumpThreshold = Number(config.spikeDelta || 5);
  const waitThreshold = Number(config.waitTimeSpikeSeconds || 30);

  if (holdCount >= holdThreshold) {
    reasons.push(`Calls on hold is ${holdCount}, threshold is ${holdThreshold}`);
  }

  if (holdCount >= 5 && maxQueueWaitSeconds >= waitThreshold) {
    reasons.push(`Queue wait is ${maxQueueWaitSeconds}s with ${holdCount} calls on hold`);
  }

  if (
    previousHoldCount !== null &&
    holdCount >= holdThreshold &&
    holdCount - previousHoldCount >= jumpThreshold
  ) {
    reasons.push(`Calls on hold jumped by ${holdCount - previousHoldCount} since the last check`);
  }

  if (holdCount >= 5 && agentsAvailable > 0 && maxQueueWaitSeconds >= waitThreshold) {
    reasons.push(
      `Queue mismatch: ${holdCount} calls on hold while ${agentsAvailable} agents are available, longest wait is ${maxQueueWaitSeconds}s`
    );
  }

  return {
    isSpike: reasons.length > 0,
    reasons,
    reasonText: reasons.join(' | ')
  };
}

export function shouldLogCall(call, config) {
  if (!config.logOnlyWaitingQueue) return true;

  const notes = `${call.notes || ''} ${call.lastAction || ''}`.toLowerCase();

  return notes.includes('waitingqueue') || notes.includes('queue wait time') || notes.includes('wait waiting');
}