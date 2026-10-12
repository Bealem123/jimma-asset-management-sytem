import { config } from './config.js';
import { createApp } from './app.js';
import { startScheduler } from './lib/scheduler.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`Jimma Asset Management API listening on http://localhost:${config.port}`);
  startScheduler();
});
