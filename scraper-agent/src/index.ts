import cors from "cors";
import express from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import puppeteer, { type Page } from "puppeteer";
import { addExtra, type VanillaPuppeteer } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv();

const puppeteerExtra = addExtra(puppeteer as unknown as VanillaPuppeteer);
puppeteerExtra.use(StealthPlugin());

const app = express();
const port = Number(process.env.PORT || 8787);
const mode = process.env.SCRAPER_MODE || "mock";
const discoveryProvider = process.env.SCRAPER_DISCOVERY_PROVIDER || "puppeteer";
const defaultSourcePath = path.resolve(process.cwd(), "fixtures", "controlled-source.html");
const adminApiUrl = process.env.IMMOBILIA_ADMIN_API_URL || "http://localhost:3000";
const userId = process.env.IMMOBILIA_USER_ID || "local-dev-user";
const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();

app.use(cors());
app.use(express.json());

const RadarInput = z.object({
  keywords: z.array(z.string()).optional(),
  country: z.string().optional(),
  zone: z.string().optional(),
  knownUrls: z.array(z.string()).optional(),
  proxy: z
    .object({
      server: z.string(),
      username: z.string().optional(),
      password: z.string().optional(),
      expiresAt: z.string().optional(),
    })
    .optional(),
  nlpProvider: z.enum(["none", "gemini", "openai", "groq", "together"]).optional(),
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "immobil-ia-local-ws-agent",
    mode,
    discoveryProvider,
    execution: "local",
    sourceUrl: mode === "live" ? scraperSourceUrl() : undefined,
    tavilyConfigured: Boolean(tavilyApiKey),
    responsibilities: [
      discoveryProvider === "tavily" ? "tavily-search" : "puppeteer",
      "local-extraction",
      "nlp-enrichment",
    ],
  });
});

app.get("/scrape/:radarId", async (request, response, next) => {
  try {
    const data = await runScrape(request.params.radarId, {});
    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.post("/scrape/:radarId", async (request, response, next) => {
  try {
    const input = RadarInput.parse(request.body);
    const data = await runScrape(request.params.radarId, input);
    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown scraper error";
  response.status(500).json({ ok: false, message });
});

app.listen(port, () => {
  console.log(`Immobil-IA scraper agent listening on ${port}`);
});

async function runScrape(radarId: string, input: z.infer<typeof RadarInput>) {
  if (mode !== "live") {
    return mockScrape(radarId, input);
  }

  if (discoveryProvider === "tavily") {
    return runTavilyDiscovery(radarId, input);
  }

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      ...(input.proxy?.server ? [`--proxy-server=${input.proxy.server}`] : []),
    ],
  });

  try {
    const page = await browser.newPage();
    if (input.proxy?.username && input.proxy.password) {
      await page.authenticate({
        username: input.proxy.username,
        password: input.proxy.password,
      });
    }
    const sourceUrl = scraperSourceUrl();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(sourceUrl, { waitUntil: "networkidle2" });
    const documents = await maybeEnrichWithNlp(await extractControlledSource(page), input);

    return {
      ok: true,
      radarId,
      mode,
      execution: "local",
      proxy: input.proxy?.server ? "temporary-token-proxy" : "direct-local-network",
      nlpProvider: input.nlpProvider || "none",
      sourceUrl,
      extractedAt: new Date().toISOString(),
      documents: filterDocuments(documents, input),
    };
  } finally {
    await browser.close();
  }
}

async function extractControlledSource(page: Page) {
  return page.evaluate(() => {
    const text = (root: Element, selector: string) =>
      root.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || undefined;
    const number = (value: string | undefined) => (value ? Number(value) : undefined);

    const listings = [...document.querySelectorAll<HTMLElement>(".listing-card")].map((card) => ({
      id: card.dataset.id,
      kind: "property",
      source: "Fuente controlada",
      title: text(card, "[data-field='title']"),
      location: card.dataset.location,
      price: number(card.dataset.price),
      areaM2: number(card.dataset.areaM2),
      rooms: number(card.dataset.rooms),
      lat: number(card.dataset.lat),
      lng: number(card.dataset.lng),
      imageUrl: card.querySelector("img")?.getAttribute("src") || undefined,
      ownerName: text(card, "[data-field='owner-name']"),
      ownerPhone: text(card, "[data-field='owner-phone']"),
      ownerEmail: text(card, "[data-field='owner-email']"),
      url: card.dataset.url,
      rawText: text(card, "[data-field='raw-text']"),
    }));

    const leads = [...document.querySelectorAll<HTMLElement>(".lead-card")].map((card) => ({
      id: card.dataset.id,
      kind: "lead",
      source: "Fuente controlada",
      name: text(card, "[data-field='name']"),
      role: card.dataset.role,
      phone: text(card, "[data-field='phone']"),
      email: text(card, "[data-field='email']"),
      address: text(card, "[data-field='address']"),
      lookingFor: text(card, "[data-field='looking-for']"),
      budget: number(card.dataset.budget),
      location: card.dataset.location,
      sourceUrl: card.dataset.sourceUrl,
      rawText: text(card, "[data-field='looking-for']"),
    }));

    return [...listings, ...leads];
  });
}

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  images?: string[];
  score?: number;
  discoveryMethod?: string;
  candidateKind?: "lead" | "property";
};

type TavilySearchResponse = {
  results?: TavilyResult[];
};

type TavilySearchOptions = {
  includeDomains?: string[];
  excludeDomains?: string[];
  searchDepth?: string;
  discoveryMethod?: string;
  candidateKind?: "lead" | "property";
};

async function runTavilyDiscovery(radarId: string, input: z.infer<typeof RadarInput>) {
  if (!tavilyApiKey) {
    throw new Error("TAVILY_API_KEY no esta configurada para SCRAPER_DISCOVERY_PROVIDER=tavily");
  }

  const knownUrls = new Set((input.knownUrls || []).map(canonicalUrl).filter(Boolean));
  const results = await discoverTavilyCandidates(input);
  const expanded = await expandTavilySeedPages(results, input);
  const expandedResults = [
    ...expanded,
    ...results,
  ];
  const extractedResults = await enrichCandidatesWithTavilyExtract(
    expandedResults.filter((result) => !knownUrls.has(canonicalUrl(result.url || "")))
  );
  const uniqueResults = prioritizeTavilyResults(uniqueTavilyResults(extractedResults, knownUrls)).slice(
    0,
    numberEnv("TAVILY_MAX_RESULTS", 10)
  );
  const documents = await maybeEnrichWithNlp(
    uniqueResults.map((result, index) => tavilyResultToDocument(result, input, index)),
    input
  );

  return {
    ok: true,
    radarId,
    mode,
    discoveryProvider,
    execution: "managed-search-local-normalization",
    proxy: input.proxy?.server ? "temporary-token-proxy-for-page-expansion" : "not-used-by-tavily-search",
    nlpProvider: input.nlpProvider || "none",
    sourceUrl: "https://api.tavily.com/search",
    extractedAt: new Date().toISOString(),
    discoveryStats: {
      seeds: results.length,
      expanded: expanded.length,
      unique: uniqueResults.length,
      skippedKnownUrls: knownUrls.size,
    },
    documents: filterDocuments(documents, input),
  };
}

async function discoverTavilyCandidates(input: z.infer<typeof RadarInput>) {
  const maxResults = numberEnv("TAVILY_MAX_RESULTS", 10);
  const queries = tavilyQueries(input);
  const perQueryMax = Math.max(2, Math.ceil(maxResults / queries.length));
  const socialLeadQueries = tavilySocialLeadQueries(input);
  const socialMaxResults = numberEnv("TAVILY_SOCIAL_MAX_RESULTS", 12);
  const perSocialQueryMax = Math.max(2, Math.ceil(socialMaxResults / Math.max(socialLeadQueries.length, 1)));
  const socialDomains = envList("TAVILY_LEAD_SOURCE_DOMAINS");
  const portalSeeds = envList("TAVILY_PORTAL_SEED_URLS").map((url) => ({
    url,
    title: titleFromUrl(url),
    content: `Fuente semilla configurada para ${input.zone || input.country || "la busqueda"}`,
    discoveryMethod: "configured-seed",
    candidateKind: "property" as const,
  }));
  const [searchResponses, socialResponses, crawlResponses, socialCrawlResponses] = await Promise.all([
    Promise.all(queries.map((query) => tavilySearch(query, perQueryMax, {
      discoveryMethod: "inventory-search",
      candidateKind: "property",
    }))),
    process.env.TAVILY_ENABLE_SOCIAL_LEAD_SEARCH === "false"
      ? Promise.resolve([])
      : Promise.all(socialLeadQueries.map((query) => tavilySearch(query, perSocialQueryMax, {
          includeDomains: socialDomains,
          searchDepth: process.env.TAVILY_SOCIAL_SEARCH_DEPTH || process.env.TAVILY_SEARCH_DEPTH || "basic",
          discoveryMethod: "social-lead-search",
          candidateKind: "lead",
        }))),
    Promise.all(envList("TAVILY_CRAWL_URLS").map((url) => tavilyCrawl(url, input, {
      discoveryMethod: "inventory-crawl",
      candidateKind: "property",
    }))),
    Promise.all(envList("TAVILY_SOCIAL_CRAWL_URLS").map((url) => tavilyCrawl(url, input, {
      discoveryMethod: "social-lead-crawl",
      candidateKind: "lead",
    }))),
  ]);
  const byUrl = new Map<string, TavilyResult>();

  for (const result of portalSeeds) {
    byUrl.set(canonicalUrl(result.url || ""), result);
  }

  for (const response of [...searchResponses, ...socialResponses, ...crawlResponses, ...socialCrawlResponses]) {
    for (const result of response.results || []) {
      const url = result.url?.trim();
      const key = canonicalUrl(url || "");
      if (!url || !key || byUrl.has(key)) continue;
      byUrl.set(key, { ...result, discoveryMethod: result.discoveryMethod || "tavily-search" });
    }
  }

  return [...byUrl.values()];
}

async function tavilySearch(
  query: string,
  maxResults: number,
  options: TavilySearchOptions = {}
): Promise<TavilySearchResponse> {
  const payload = {
    query,
    search_depth: options.searchDepth || process.env.TAVILY_SEARCH_DEPTH || "basic",
    topic: process.env.TAVILY_TOPIC || "general",
    max_results: maxResults,
    include_answer: false,
    include_raw_content: true,
    include_domains: options.includeDomains || envList("TAVILY_INCLUDE_DOMAINS"),
    exclude_domains: options.excludeDomains || envList("TAVILY_EXCLUDE_DOMAINS"),
  };

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyApiKey}`,
    },
    body: JSON.stringify(payload),
  }, numberEnv("TAVILY_REQUEST_TIMEOUT_MS", 90_000));

  if (response.ok) {
    return markTavilyResults(await response.json(), options);
  }

  const fallbackResponse = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, api_key: tavilyApiKey }),
  }, numberEnv("TAVILY_REQUEST_TIMEOUT_MS", 90_000));

  if (!fallbackResponse.ok) {
    const message = await fallbackResponse.text();
    throw new Error(`Tavily search fallo (${fallbackResponse.status}): ${message}`);
  }

  return markTavilyResults(await fallbackResponse.json(), options);
}

async function tavilyCrawl(
  url: string,
  input: z.infer<typeof RadarInput>,
  options: TavilySearchOptions = {}
): Promise<TavilySearchResponse> {
  const instructions =
    process.env.TAVILY_CRAWL_INSTRUCTIONS ||
    `Encuentra publicaciones inmobiliarias y leads de personas buscando inmueble en ${input.zone || input.country || "la zona objetivo"}.`;
  const payload = {
    url,
    max_depth: numberEnv("TAVILY_CRAWL_MAX_DEPTH", 1),
    limit: numberEnv("TAVILY_CRAWL_LIMIT", 5),
    instructions,
  };

  const response = await fetchWithTimeout("https://api.tavily.com/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyApiKey}`,
    },
    body: JSON.stringify(payload),
  }, numberEnv("TAVILY_REQUEST_TIMEOUT_MS", 90_000));

  if (!response.ok) {
    console.warn(`Tavily crawl skipped for ${url}: HTTP ${response.status}`);
    return { results: [] };
  }

  const data = (await response.json()) as {
    results?: Array<{ url?: string; raw_content?: string; content?: string }>;
  };

  return {
    results: (data.results || []).map((result) => {
      const mapped = {
        url: result.url,
        title: titleFromRawContent(result.raw_content || result.content || result.url || ""),
        content: result.content,
        raw_content: result.raw_content,
        discoveryMethod: options.discoveryMethod || "tavily-crawl",
        candidateKind: options.candidateKind,
      } satisfies TavilyResult;
      return {
        ...mapped,
        candidateKind:
          options.candidateKind === "lead" ? inferSocialCandidateKind(mapped) : options.candidateKind,
      };
    }),
  };
}

function markTavilyResults(payload: unknown, options: TavilySearchOptions): TavilySearchResponse {
  const data = payload as TavilySearchResponse;
  return {
    results: (data.results || []).map((result) => ({
      ...result,
      discoveryMethod: options.discoveryMethod || result.discoveryMethod,
      candidateKind:
        options.candidateKind === "lead"
          ? inferSocialCandidateKind(result)
          : options.candidateKind || result.candidateKind,
    })),
  };
}

async function enrichCandidatesWithTavilyExtract(results: TavilyResult[]) {
  const urls = results
    .map((result) => result.url)
    .filter((url): url is string => Boolean(url))
    .slice(0, numberEnv("TAVILY_EXTRACT_LIMIT", 8));
  if (!urls.length) return results;

  const extracted = await tavilyExtract(urls);
  const extractedByUrl = new Map(extracted.map((result) => [canonicalUrl(result.url || ""), result]));

  return results.map((result) => {
    const extractedResult = extractedByUrl.get(canonicalUrl(result.url || ""));
    if (!extractedResult) return result;
    return {
      ...result,
      content: extractedResult.content || result.content,
      raw_content: extractedResult.raw_content || result.raw_content,
      images: extractedResult.images || result.images,
      discoveryMethod: `${result.discoveryMethod || "tavily"}+extract`,
    };
  });
}

async function tavilyExtract(urls: string[]): Promise<TavilyResult[]> {
  const payload = {
    urls,
    extract_depth: process.env.TAVILY_EXTRACT_DEPTH || "basic",
    include_images: true,
  };
  const response = await fetchWithTimeout("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyApiKey}`,
    },
    body: JSON.stringify(payload),
  }, numberEnv("TAVILY_REQUEST_TIMEOUT_MS", 90_000));

  if (response.ok) {
    return extractResultsFromTavilyPayload(await response.json());
  }

  const fallbackResponse = await fetchWithTimeout("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, api_key: tavilyApiKey }),
  }, numberEnv("TAVILY_REQUEST_TIMEOUT_MS", 90_000));

  if (!fallbackResponse.ok) {
    console.warn(`Tavily extract skipped: HTTP ${fallbackResponse.status}`);
    return [];
  }

  return extractResultsFromTavilyPayload(await fallbackResponse.json());
}

function extractResultsFromTavilyPayload(payload: unknown): TavilyResult[] {
  const data = payload as {
    results?: Array<{ url?: string; raw_content?: string; content?: string; images?: string[] }>;
  };
  return (data.results || []).map((result) => ({
    url: result.url,
    title: titleFromRawContent(result.raw_content || result.content || result.url || ""),
    content: result.content,
    raw_content: result.raw_content,
    images: result.images,
  }));
}

async function expandTavilySeedPages(
  results: TavilyResult[],
  input: z.infer<typeof RadarInput>
) {
  if (process.env.TAVILY_ENABLE_PAGE_EXPANSION === "false") return [];

  const seeds = results
    .filter((result) => result.url && shouldExpandSeedUrl(result))
    .slice(0, numberEnv("TAVILY_EXPAND_SEED_LIMIT", 2));
  if (!seeds.length) return [];

  const browser = await launchBrowser(input);
  const expanded: TavilyResult[] = [];
  try {
    for (const seed of seeds) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(seed.url || "", { waitUntil: "domcontentloaded", timeout: 35_000 });
        await page.waitForNetworkIdle({ idleTime: 800, timeout: 8_000 }).catch(() => undefined);
        expanded.push(...(await extractCandidateLinksFromPage(page, seed, input)));
      } catch (error) {
        console.warn(`Seed expansion skipped for ${seed.url}:`, error);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }

  return uniqueTavilyResults(expanded);
}

async function launchBrowser(input: z.infer<typeof RadarInput>) {
  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      ...(input.proxy?.server ? [`--proxy-server=${input.proxy.server}`] : []),
    ],
  });
  return browser;
}

async function extractCandidateLinksFromPage(
  page: Page,
  seed: TavilyResult,
  input: z.infer<typeof RadarInput>
): Promise<TavilyResult[]> {
  const candidates = await page.evaluate(
    ({ zone, country }) => {
      const normalize = (value: string | null | undefined) =>
        value?.replace(/\s+/g, " ").trim() || "";
      const cardSelector = [
        "article",
        "[class*='card']",
        "[class*='listing']",
        "[class*='property']",
        "[class*='inmueble']",
        "[class*='item']",
        "li",
      ].join(",");
      const terms = [
        "apartamento",
        "apartaestudio",
        "casa",
        "inmueble",
        "arriendo",
        "arrend",
        "venta",
        "habitacion",
        "m2",
        "chapinero",
        normalize(zone).toLowerCase(),
        normalize(country).toLowerCase(),
      ].filter(Boolean);

      return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((anchor) => {
          const href = new URL(anchor.href, window.location.href).toString();
          const container = anchor.closest(cardSelector);
          const rawText = normalize([anchor.textContent, container?.textContent].filter(Boolean).join(" "));
          const imageUrl =
            container?.querySelector("img")?.getAttribute("src") ||
            anchor.querySelector("img")?.getAttribute("src") ||
            undefined;
          const title = normalize(anchor.textContent) || rawText.split(".")[0]?.slice(0, 140);
          const lower = `${href} ${rawText}`.toLowerCase();
          const score = terms.filter((term) => lower.includes(term)).length;
          const noise = [
            "login",
            "registro",
            "contacto",
            "politica",
            "terminos",
            "pago",
            "afiliate",
            "facebook.com/sharer",
            "whatsapp://",
          ].some((term) => lower.includes(term));
          return { href, title, rawText, imageUrl, score, noise };
        })
        .filter(
          (candidate) =>
            candidate.href.startsWith("http") &&
            !candidate.noise &&
            candidate.score >= 2 &&
            candidate.rawText.length >= 30
        )
        .slice(0, 40);
    },
    { zone: input.zone, country: input.country }
  );

  return candidates.map((candidate, index) => ({
    title: candidate.title || titleFromUrl(candidate.href),
    url: candidate.href,
    content: candidate.rawText,
    raw_content: candidate.rawText,
    images: candidate.imageUrl ? [candidate.imageUrl] : undefined,
    score: candidate.score,
    discoveryMethod: `puppeteer-seed-expansion:${seed.url || index}`,
  }));
}

function shouldExpandSeedUrl(result: TavilyResult) {
  const text = `${result.url || ""} ${result.title || ""} ${result.content || ""}`.toLowerCase();
  return [
    "inmueble",
    "apartamento",
    "arriendo",
    "venta",
    "fincaraiz",
    "ciencuadras",
    "metrocuadrado",
    "compensar",
    "banco-de-inmuebles",
    "facebook",
  ].some((term) => text.includes(term));
}

function tavilyQueries(input: z.infer<typeof RadarInput>) {
  const keywords = input.keywords?.length ? input.keywords.join(" ") : "apartamento casa inmueble";
  const location = [input.zone, input.country].filter(Boolean).join(" ");
  return [
    `${keywords} ${location} arriendo venta propietario inmobiliaria telefono whatsapp`.trim(),
    `"apartamento en arriendo" "${input.zone || input.country || ""}" precio habitaciones`.trim(),
    `"inmueble" "${input.zone || input.country || ""}" arriendo propietario`.trim(),
    `busco necesito compro arriendo ${keywords} ${location} presupuesto telefono whatsapp`.trim(),
    `"busco apartamento" "${input.zone || input.country || ""}" presupuesto`.trim(),
    ...envList("TAVILY_EXTRA_QUERIES"),
  ].filter(Boolean);
}

function tavilySocialLeadQueries(input: z.infer<typeof RadarInput>) {
  const keywords = input.keywords?.length ? input.keywords.join(" ") : "apartamento casa inmueble";
  const location = [input.zone, input.country].filter(Boolean).join(" ");
  return [
    `"busco apartamento" "${location}" presupuesto whatsapp`,
    `"necesito apartamento" "${location}" arriendo`,
    `"estoy buscando" "${keywords}" "${location}"`,
    `"quien arrienda" apartamento "${location}"`,
    `"recomiendan" apartamento arriendo "${location}"`,
    `"busco" "${keywords}" "${location}" site:facebook.com/groups`,
    `"busco" "${keywords}" "${location}" site:reddit.com`,
    ...envList("TAVILY_SOCIAL_EXTRA_QUERIES"),
  ].filter(Boolean);
}

function titleFromRawContent(content: string) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return firstLine?.slice(0, 140);
}

function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 140);
  }
}

function tavilyResultToDocument(
  result: TavilyResult,
  input: z.infer<typeof RadarInput>,
  index: number
) {
  const rawText = [result.title, result.content, result.raw_content].filter(Boolean).join("\n");
  const kind = result.candidateKind || inferDocumentKind(rawText);
  const base = {
    id: stableTavilyId(result.url || `${result.title}-${index}`),
    kind,
    source: "Tavily",
    location: input.zone || input.country || "Sin zona",
    sourceUrl: result.url,
    url: result.url,
    rawText,
    tavilyScore: result.score,
    discoveryMethod: result.discoveryMethod,
  };

  if (kind === "lead") {
    return {
      ...base,
      name: result.title?.slice(0, 80) || "Lead detectado",
      lookingFor: result.content || result.title || "Lead inmobiliario detectado por Tavily",
    };
  }

  return {
    ...base,
    title: result.title || "Publicacion detectada por Tavily",
    imageUrl: result.images?.[0],
  };
}

function inferDocumentKind(text: string): "lead" | "property" {
  const normalized = text.toLowerCase();
  const leadSignals = [
    "busco",
    "busca",
    "necesito",
    "quiero",
    "compro",
    "interesado",
    "presupuesto",
    "estoy buscando",
    "alguien sabe",
    "quien arrienda",
    "quién arrienda",
    "recomiendan",
    "recomendacion",
    "recomendación",
    "urgente",
    "whatsapp",
  ];
  const propertySignals = [
    "se arrienda",
    "arriendo",
    "venta",
    "vendo",
    "apartamento en",
    "casa en",
    "habitaciones",
    "m2",
  ];
  const leadScore = leadSignals.filter((signal) => normalized.includes(signal)).length;
  const propertyScore = propertySignals.filter((signal) => normalized.includes(signal)).length;
  return leadScore > propertyScore ? "lead" : "property";
}

function inferSocialCandidateKind(result: TavilyResult): "lead" | "property" | undefined {
  const text = `${result.title || ""} ${result.content || ""} ${result.raw_content || ""}`.toLowerCase();
  const demandSignals = [
    "busco",
    "busca",
    "necesito",
    "estoy buscando",
    "alguien sabe",
    "quien arrienda",
    "quién arrienda",
    "recomiendan",
    "recomendacion",
    "recomendación",
    "presupuesto",
    "para vivir",
    "me urge",
  ];
  const supplySignals = [
    "se arrienda",
    "arrienda apartamento",
    "arriendo apartamento",
    "apartamento en arriendo",
    "disponible",
    "contactar",
    "llamar",
    "whatsapp:",
    "$",
    "m²",
    "m2",
    "habitaciones",
    "baños",
    "garaje",
  ];
  const demandScore = demandSignals.filter((signal) => text.includes(signal)).length;
  const supplyScore = supplySignals.filter((signal) => text.includes(signal)).length;
  if (demandScore >= 1 && demandScore >= supplyScore) return "lead";
  if (supplyScore > 0) return "property";
  return undefined;
}

function stableTavilyId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `tavily-${hash.toString(16)}`;
}

function uniqueTavilyResults(results: TavilyResult[], knownUrls = new Set<string>()) {
  const byUrl = new Map<string, TavilyResult>();
  for (const result of results) {
    const key = canonicalUrl(result.url || "");
    if (!key || knownUrls.has(key) || byUrl.has(key)) continue;
    byUrl.set(key, result);
  }
  return [...byUrl.values()];
}

function prioritizeTavilyResults(results: TavilyResult[]) {
  return [...results].sort((left, right) => tavilyPriority(right) - tavilyPriority(left));
}

function tavilyPriority(result: TavilyResult) {
  const text = `${result.url || ""} ${result.title || ""} ${result.content || ""} ${result.raw_content || ""}`.toLowerCase();
  let score = Number(result.score || 0);
  if (result.candidateKind === "lead") score += 30;
  if (result.discoveryMethod?.includes("social-lead")) score += 20;
  if (result.discoveryMethod?.includes("puppeteer-seed-expansion")) score += 18;
  if (/\/inmueble\/|\/property\/|\/apartamento-|\/apartamento\//.test(text)) score += 12;
  if (containsAnyText(text, ["busco", "necesito", "estoy buscando", "presupuesto", "whatsapp"])) score += 10;
  if (containsAnyText(text, ["login", "registro", "politica", "terminos"])) score -= 20;
  return score;
}

function canonicalUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    parsed.searchParams.sort();
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|yclid)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function containsAnyText(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function scraperSourceUrl() {
  const configured = process.env.SCRAPER_SOURCE_URL?.trim();
  if (configured) return configured;
  return pathToFileURL(defaultSourcePath).toString();
}

function filterDocuments(
  documents: Array<Record<string, unknown>>,
  input: z.infer<typeof RadarInput>
) {
  const zone = input.zone?.toLowerCase();
  const keywords = input.keywords?.map((keyword) => keyword.toLowerCase()) || [];

  return documents.filter((document) => {
    const documentZone = String(document.location || "").toLowerCase();
    const searchable = [
      document.title,
      document.name,
      document.lookingFor,
      document.rawText,
      document.location,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesZone = !zone || documentZone.includes(zone) || zone.includes(documentZone);
    const matchesKeywords =
      keywords.length === 0 || keywords.some((keyword) => searchable.includes(keyword));

    return matchesZone && matchesKeywords;
  });
}

async function mockScrape(radarId: string, input: z.infer<typeof RadarInput>) {
  const zone = input.zone || "Bogota - Chapinero";
  return {
    ok: true,
    radarId,
    mode,
    execution: "local",
    proxy: input.proxy?.server ? "temporary-token-proxy" : "direct-local-network",
    nlpProvider: input.nlpProvider || "none",
    extractedAt: new Date().toISOString(),
    documents: await maybeEnrichMockDocuments(
      [
      {
        id: `mock-property-${radarId}`,
        kind: "property",
        source: "Portal simulado",
        title: "Apartamento iluminado publicado por agencia",
        location: zone,
        price: 420000000,
        areaM2: 72,
        rooms: 2,
        rawText:
          "Agencia publica apartamento exterior. Texto contiene telefono alterno y posible nombre de propietario.",
      },
      {
        id: `mock-lead-${radarId}`,
        kind: "lead",
        source: "Foro simulado",
        name: "Andres Gomez",
        lookingFor: "Apartamento de 2 habitaciones para compra",
        budget: 450000000,
        location: zone,
      },
      ],
      input
    ),
  };
}

async function maybeEnrichWithNlp(
  documents: Array<Record<string, unknown>>,
  input: z.infer<typeof RadarInput>
) {
  const provider = input.nlpProvider || "none";
  if (provider === "none") return documents;

  return Promise.all(
    documents.map(async (document) => {
      const rawText = String(document.rawText || document.title || document.lookingFor || "").trim();
      if (!rawText) return document;

      try {
        const response = await fetchWithTimeout(
          `${adminApiUrl}/nlp/extract`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-immobilia-user-id": userId,
              ...authHeaders(),
            },
            body: JSON.stringify({
              text: rawText,
              hint: document.kind === "lead" ? "lead" : "publication",
              sourceUrl: document.url || document.sourceUrl,
            }),
          },
          numberEnv("NLP_REQUEST_TIMEOUT_MS", 20_000)
        );

        if (!response.ok) return document;
        const payload = (await response.json()) as {
          extracted?: {
            confidence?: number;
            lead?: Record<string, unknown>;
            publication?: Record<string, unknown>;
          };
        };
        const extracted = payload.extracted;
        if (!extracted) return document;
        const extractedDocument =
          document.kind === "lead" ? extracted.lead || {} : extracted.publication || {};

        return {
          ...normalizeExtractedFields(extractedDocument),
          ...document,
          nlpConfidence: extracted.confidence,
        };
      } catch (error) {
        console.warn("NLP enrichment failed; keeping locally extracted document", error);
        return document;
      }
    })
  );
}

async function maybeEnrichMockDocuments(
  documents: Array<Record<string, unknown>>,
  input: z.infer<typeof RadarInput>
) {
  return maybeEnrichWithNlp(documents, input);
}

function authHeaders(): Record<string, string> {
  const token = process.env.IMMOBILIA_LICENSE_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeExtractedFields(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => {
        if (["budget", "price", "rooms", "areaM2"].includes(key)) {
          return [key, numericValue(value) ?? value];
        }
        return [key, value];
      })
  );
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envList(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
