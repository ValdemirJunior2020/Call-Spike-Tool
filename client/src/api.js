async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  status: () => request('/api/status'),
  start: () => request('/api/start', { method: 'POST' }),
  stop: () => request('/api/stop', { method: 'POST' }),
  check: () => request('/api/check', { method: 'POST' }),
  saveConfig: (config) => request('/api/config', { method: 'POST', body: JSON.stringify(config) })
};
