/**
 * fetch with a timeout. On a phone, an unreachable server can otherwise hang a
 * request for a minute or more; this fails fast with a readable message.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw Error(`No response after ${Math.round(ms / 1000)} s. Check the address and that the server is running.`);
    throw e instanceof Error ? e : Error('Network request failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Parse JSON without throwing on HTML error pages. */
export async function readJson<T = unknown>(r: Response): Promise<T> {
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw Error(r.ok ? 'The server sent something that is not JSON.' : `Server returned ${r.status}`);
  }
}
