export default async function run(page, ui) {
  const logs = [];
  page.on('console', msg => logs.push(msg.type() + ': ' + msg.text()));
  page.on('pageerror', err => logs.push('PAGE ERROR: ' + err.message));
  await page.waitForTimeout(5000);
  return { logs };
}