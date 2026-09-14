export type AnakinScrape = {
  id?: string;
  jobId?: string;
  status: 'completed' | 'pending' | 'processing' | 'failed';
  url: string;
  markdown?: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  cached?: boolean;
};

type FetchLike = typeof fetch;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A small adapter around Anakin's URL Scraper. It never exposes an API key to the browser. */
export class AnakinClient {
  constructor(
    private readonly apiKey = process.env.ANAKIN_API_KEY,
    private readonly fetcher: FetchLike = fetch,
    private readonly endpoint = process.env.ANAKIN_URL_SCRAPER_BASE_URL ?? 'https://api.anakin.io/v1/url-scraper',
  ) {}
  private headers(): HeadersInit { return { 'content-type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) }; }
  private async response(response: Response): Promise<AnakinScrape> {
    const body = await response.json().catch(() => ({})) as AnakinScrape;
    if (!response.ok) throw new Error(body.error || `Anakin URL Scraper returned HTTP ${response.status}.`);
    return body;
  }
  async scrape(url: string): Promise<AnakinScrape> {
    const submitted = await this.response(await this.fetcher(`${this.endpoint}/scrape`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ url }) }));
    if (submitted.status === 'completed' || submitted.status === 'failed') return submitted;
    const jobId = submitted.id ?? submitted.jobId;
    if (!jobId) throw new Error('Anakin accepted the scrape without a job identifier.');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(1_000);
      const polled = await this.response(await this.fetcher(`${this.endpoint}/${encodeURIComponent(jobId)}`, { headers: this.headers() }));
      if (polled.status === 'completed' || polled.status === 'failed') return polled;
    }
    throw new Error('Anakin scrape did not finish within 30 seconds.');
  }
}
