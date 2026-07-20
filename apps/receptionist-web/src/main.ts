import './styles.css';
import { createApiClient } from './api';
import { readFrontendConfig } from './config';
import { mountReceptionistApp } from './ui';

const buildSha = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown';

console.info(`Build: ${buildSha.slice(0, 7)}`);

const root = document.getElementById('app');

if (!root) {
  throw new Error('Missing app root element');
}

const config = readFrontendConfig();
const api = createApiClient({ baseUrl: config.apiUrl });

mountReceptionistApp({
  root,
  api,
});
