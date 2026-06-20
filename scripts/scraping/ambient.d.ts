declare module "firecrawl" {
  export interface FirecrawlScrapeResult {
    html?: string;
    actions?: Record<string, unknown>;
  }

  export interface FirecrawlClientOptions {
    apiKey?: string;
  }

  export class Firecrawl {
    constructor(opts?: FirecrawlClientOptions | string);
    scrape(
      url: string,
      options?: Record<string, unknown>,
    ): Promise<FirecrawlScrapeResult>;
  }

  export default Firecrawl;
}
