// Launch the built Electron app via Playwright _electron, drive the real
// Add-camera flow against the sim camera (127.0.0.1:8099), exercise a control
// and a preset, and screenshot the renderer to .work/app-shot.png.
import { _electron as electron } from 'playwright-core';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../packages/app', import.meta.url));
const outPath = fileURLToPath(new URL('../.work/app-shot.png', import.meta.url));

const app = await electron.launch({ args: ['out/main/index.js'], cwd: appDir });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

// Add + connect the sim camera through the real UI flow.
await page.getByPlaceholder('Name').fill('C300 III (sim)');
await page.getByPlaceholder('IP address').fill('127.0.0.1:8099');
await page.getByRole('button', { name: 'Add + Connect' }).click();

// Wait for the camera panel to populate from info.cgi.
await page.getByText('Canon EOS C300 Mark III').first().waitFor({ timeout: 10000 });
await sleep(1500); // let controls + stream settle

// Save a couple of presets so the preset bar is populated in the shot.
await page.getByPlaceholder('Preset name').fill('Podium');
await page.getByRole('button', { name: 'Save' }).click();
await sleep(400);
await page.getByPlaceholder('Preset name').fill('Wide');
await page.getByRole('button', { name: 'Save' }).click();
await sleep(500);

await page.screenshot({ path: outPath });
console.log('shot saved to', outPath);
await app.close();
