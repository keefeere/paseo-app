const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;

// A cold Metro transform cache (a laptop spinning up the first bundle on slow storage) can take
// well past two minutes. Override with E2E_METRO_WARMUP_TIMEOUT_MS instead of raising the default,
// so CI still fails fast when the dev server genuinely wedges.
function warmupTimeoutMs() {
  const raw = process.env.E2E_METRO_WARMUP_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARMUP_TIMEOUT_MS;
}

/** @param {number} port */
export async function warmMetro(port) {
  const timeoutMs = warmupTimeoutMs();
  const origin = `http://127.0.0.1:${port}`;
  const documentResponse = await fetch(origin, { signal: AbortSignal.timeout(timeoutMs) });
  if (!documentResponse.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.status}`);
  }
  const document = await documentResponse.text();
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await response.arrayBuffer();
  }
}
