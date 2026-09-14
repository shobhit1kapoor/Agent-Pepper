export type BrowserOSStatus = {
  configured: boolean;
  endpoint: string | null;
  reachable: boolean;
  status: 'available' | 'unavailable' | 'not_configured';
  checkedAt: number;
  cdpConnected?: boolean;
  detail?: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function probeBrowserOS(configuredEndpoint: string | undefined, fetcher: Fetcher = fetch): Promise<BrowserOSStatus> {
  const checkedAt = Date.now();
  if (!configuredEndpoint?.trim()) {
    return { configured: false, endpoint: null, reachable: false, status: 'not_configured', checkedAt, detail: 'Set BROWSEROS_ENDPOINT to an operator-started local BrowserOS server.' };
  }
  let endpoint: URL;
  try { endpoint = new URL(configuredEndpoint); }
  catch { return { configured: true, endpoint: null, reachable: false, status: 'unavailable', checkedAt, detail: 'BROWSEROS_ENDPOINT must be a valid loopback HTTP URL.' }; }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    return { configured: true, endpoint: endpoint.origin, reachable: false, status: 'unavailable', checkedAt, detail: 'BrowserOS discovery only permits a loopback HTTP endpoint.' };
  }
  const healthUrl = new URL('/system/health', endpoint).toString();
  try {
    const response = await fetcher(healthUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return { configured: true, endpoint: endpoint.origin, reachable: false, status: 'unavailable', checkedAt, detail: `BrowserOS health returned HTTP ${response.status}.` };
    const body = await response.json() as { status?: unknown; cdpConnected?: unknown };
    if (body.status !== 'ok') return { configured: true, endpoint: endpoint.origin, reachable: true, status: 'unavailable', checkedAt, detail: 'BrowserOS health response was not recognized.' };
    return { configured: true, endpoint: endpoint.origin, reachable: true, status: 'available', checkedAt, cdpConnected: body.cdpConnected === true };
  } catch {
    return { configured: true, endpoint: endpoint.origin, reachable: false, status: 'unavailable', checkedAt, detail: 'BrowserOS is not reachable at the configured loopback endpoint.' };
  }
}
