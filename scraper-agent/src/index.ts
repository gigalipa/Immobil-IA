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
const defaultSourcePath = path.resolve(process.cwd(), "fixtures", "controlled-source.html");
const adminApiUrl = process.env.IMMOBILIA_ADMIN_API_URL || "http://localhost:3000";
const userId = process.env.IMMOBILIA_USER_ID || "local-dev-user";

app.use(cors());
app.use(express.json());

const RadarInput = z.object({
  keywords: z.array(z.string()).optional(),
  country: z.string().optional(),
  zone: z.string().optional(),
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
    execution: "local",
    sourceUrl: mode === "live" ? scraperSourceUrl() : undefined,
    responsibilities: ["puppeteer", "html-rendering", "local-extraction"],
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
        const response = await fetch(`${adminApiUrl}/nlp/extract`, {
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
        });

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
