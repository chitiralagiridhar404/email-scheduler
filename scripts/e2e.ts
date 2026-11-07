/**
 * End-to-end check (server must be running): schedules 3 emails ~6s out,
 * prints their status over time. Use with a restart in the middle to prove
 * jobs survive:  npm run test:e2e   (then restart the server before they fire)
 */
const base = process.env.BASE ?? "http://localhost:3000";

async function main() {
  const at = new Date(Date.now() + 8000).toISOString();
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${base}/api/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: `test${i}@example.com`, subject: `E2E ${i}`, body: "hello", sendAt: at }),
    });
    ids.push(((await r.json()) as any).id);
  }
  console.log("scheduled", ids, "for", at);
  for (let t = 0; t < 8; t++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await (await fetch(`${base}/api/stats`)).json();
    console.log(new Date().toISOString(), JSON.stringify(s));
  }
}
main();
