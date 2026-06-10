import { _electron as electron } from 'playwright-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../packages/app', import.meta.url));
const app = await electron.launch({ args: ['out/main/index.js'], cwd: appDir });
const page = await app.firstWindow();
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1] ?? ''));
await sleep(2500);
const html = await page.content();
console.log('--- has Name input? ---', html.includes('placeholder="Name"'));
console.log('--- body text (first 300) ---', (await page.locator('body').innerText()).slice(0, 300));
await page.screenshot({ path: fileURLToPath(new URL('../.work/debug.png', import.meta.url)) });
console.log('screenshot saved');
await app.close();
