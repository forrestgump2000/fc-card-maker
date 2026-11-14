// Server-side proxy to remove.bg so the API key never reaches the browser.
// Set REMOVE_BG_API_KEY in the Vercel project's environment variables.
// Optional: REMOVE_BG_SIZE = "preview" (default, free tier) | "auto" | "full" (uses credits).

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const key = process.env.REMOVE_BG_API_KEY;
  if (!key) { res.status(501).json({ error: 'remove.bg is not set up' }); return; }

  // only accept calls coming from this site
  const host = req.headers.host || '';
  const origin = req.headers.origin || '';
  if (origin && !origin.endsWith(host)) { res.status(403).end(); return; }

  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4 * 1024 * 1024) { res.status(413).json({ error: 'image too large' }); return; }
    chunks.push(c);
  }
  const form = new FormData();
  form.append('image_file', new Blob([Buffer.concat(chunks)], { type: req.headers['content-type'] || 'image/jpeg' }), 'photo.jpg');
  form.append('size', process.env.REMOVE_BG_SIZE || 'preview');
  form.append('format', 'png');

  try {
    const r = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form });
    if (!r.ok) { res.status(502).json({ error: (await r.text()).slice(0, 300) }); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: 'remove.bg request failed' });
  }
};
