import cors from "cors";
import express from "express";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { z } from "zod";

loadEnv();

const { Pool } = pg;
const app = express();
const port = Number(process.env.THIN_SERVER_PORT || process.env.PORT || 3000);
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://immobilia:immobilia_dev@localhost:5432/immobilia";

const pool = new Pool({
  connectionString: databaseUrl,
});

const FeedbackEvent = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  entityId: z.string().min(1),
  decision: z.string().min(1),
  payload: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const FeedbackSyncRequest = z.object({
  events: z.array(FeedbackEvent).min(1),
});

const AgentRunCompletedRequest = z.object({
  runId: z.string().min(1),
  radarId: z.string().min(1),
  radarName: z.string().optional(),
  status: z.string().default("completed"),
  publicationsCount: z.number().int().nonnegative().default(0),
  leadsCount: z.number().int().nonnegative().default(0),
  matchesCount: z.number().int().nonnegative().default(0),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
  notifyOnCompletion: z.boolean().default(true),
  payload: z.record(z.unknown()).nullable().optional(),
});

const NlpExtractRequest = z.object({
  text: z.string().min(8).max(8000),
  hint: z.enum(["auto", "lead", "publication"]).default("auto"),
  sourceUrl: z.string().optional(),
  locale: z.string().default("es-CO"),
});

const ProxyTokenRequest = z.object({
  radarId: z.string().min(1),
  radarName: z.string().optional(),
  country: z.string().optional(),
  zone: z.string().optional(),
});

type NlpExtracted = {
  kind: "lead" | "publication" | "unknown";
  confidence: number;
  rawText: string;
  lead?: Record<string, unknown>;
  publication?: Record<string, unknown>;
};

type ProxyToken = {
  server: string;
  username?: string;
  password?: string;
  provider: "static" | "webshare";
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({
      ok: true,
      service: "immobil-ia-thin-server",
      database: "postgres",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/feedback/events", async (request, response, next) => {
  try {
    const userId = requireUserId(request);
    const input = FeedbackSyncRequest.parse(request.body);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of input.events) {
        await client.query(
          `
          INSERT INTO client_feedback_events (
            id, user_id, kind, entity_id, decision, payload, local_created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          ON CONFLICT (id) DO UPDATE SET
            user_id = excluded.user_id,
            kind = excluded.kind,
            entity_id = excluded.entity_id,
            decision = excluded.decision,
            payload = excluded.payload,
            local_created_at = excluded.local_created_at,
            received_at = now()
          `,
          [
            event.id,
            userId,
            event.kind,
            event.entityId,
            event.decision,
            JSON.stringify(event.payload || {}),
            event.createdAt || null,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    response.json({
      ok: true,
      accepted: input.events.length,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/agent-runs/completed", async (request, response, next) => {
  try {
    const userId = requireUserId(request);
    const input = AgentRunCompletedRequest.parse(request.body);

    await pool.query(
      `
      INSERT INTO agent_run_events (
        id, user_id, radar_id, radar_name, status, publications_count,
        leads_count, matches_count, started_at, finished_at, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        user_id = excluded.user_id,
        radar_id = excluded.radar_id,
        radar_name = excluded.radar_name,
        status = excluded.status,
        publications_count = excluded.publications_count,
        leads_count = excluded.leads_count,
        matches_count = excluded.matches_count,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        payload = excluded.payload,
        received_at = now()
      `,
      [
        input.runId,
        userId,
        input.radarId,
        input.radarName || null,
        input.status,
        input.publicationsCount,
        input.leadsCount,
        input.matchesCount,
        input.startedAt || null,
        input.finishedAt || null,
        JSON.stringify(input.payload || {}),
      ]
    );

    const notification = await sendAgentRunCompletedNotification(userId, input);

    response.json({ ok: true, notification });
  } catch (error) {
    next(error);
  }
});

app.post("/nlp/extract", async (request, response, next) => {
  try {
    const userId = requireUserId(request);
    const input = NlpExtractRequest.parse(request.body);
    const provider = configuredNlpProvider();
    const result = await extractWithNlp(input, provider);

    await pool.query(
      `
      INSERT INTO nlp_extraction_events (
        user_id, provider, kind, confidence, source_url, input_text, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        userId,
        result.provider,
        result.extracted.kind,
        result.extracted.confidence,
        input.sourceUrl || null,
        input.text,
        JSON.stringify(result.extracted),
      ]
    );

    response.json({
      ok: true,
      provider: result.provider,
      extracted: result.extracted,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/proxy/token", async (request, response, next) => {
  try {
    const userId = requireUserId(request);
    const input = ProxyTokenRequest.parse(request.body);
    const proxy = await resolveProxyToken(input);
    const expiresAt = new Date(Date.now() + proxyTtlMinutes() * 60_000).toISOString();
    const payload = {
      radarName: input.radarName || null,
      country: input.country || null,
      zone: input.zone || null,
      proxyServer: proxy?.server || null,
      provider: proxy?.provider || configuredProxyProvider(),
    };

    await pool.query(
      `
      INSERT INTO proxy_token_events (
        user_id, radar_id, mode, granted, expires_at, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        userId,
        input.radarId,
        proxy?.provider || "direct",
        Boolean(proxy),
        proxy ? expiresAt : null,
        JSON.stringify(payload),
      ]
    );

    response.json({
      ok: true,
      mode: proxy?.provider || "direct",
      expiresAt: proxy ? expiresAt : null,
      proxy: proxy
        ? {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
            expiresAt,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/feedback/summary", async (_request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT kind, decision, count(*)::int AS count
      FROM client_feedback_events
      GROUP BY kind, decision
      ORDER BY kind, decision
      `
    );
    response.json({ ok: true, summary: rows });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/feedback/export", async (request, response, next) => {
  try {
    const format = request.query.format === "json" ? "json" : "jsonl";
    const { rows } = await pool.query(
      `
      SELECT
        id,
        user_id AS "userId",
        kind,
        entity_id AS "entityId",
        decision,
        payload,
        local_created_at AS "localCreatedAt",
        received_at AS "receivedAt"
      FROM client_feedback_events
      ORDER BY received_at DESC
      LIMIT 10000
      `
    );

    const events = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      entityId: row.entityId,
      decision: row.decision,
      payload: row.payload || {},
      localCreatedAt: row.localCreatedAt,
      receivedAt: row.receivedAt,
    }));

    if (format === "json") {
      response.json({ ok: true, events });
      return;
    }

    const body = events.map((event) => JSON.stringify(event)).join("\n");
    response
      .type("application/x-ndjson")
      .setHeader("Content-Disposition", "attachment; filename=\"immobilia-feedback.jsonl\"")
      .send(body ? `${body}\n` : "");
  } catch (error) {
    next(error);
  }
});

app.get("/admin/operations/summary", async (_request, response, next) => {
  try {
    const feedback = await pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE (received_at AT TIME ZONE 'America/Bogota')::date =
            (now() AT TIME ZONE 'America/Bogota')::date
        )::int AS today
      FROM client_feedback_events
    `);
    const runs = await pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE (received_at AT TIME ZONE 'America/Bogota')::date =
            (now() AT TIME ZONE 'America/Bogota')::date
        )::int AS today,
        coalesce(sum(publications_count), 0)::int AS publications,
        coalesce(sum(leads_count), 0)::int AS leads,
        coalesce(sum(matches_count), 0)::int AS matches
      FROM agent_run_events
    `);
    const latestRun = await pool.query(`
      SELECT
        id,
        user_id AS "userId",
        radar_id AS "radarId",
        radar_name AS "radarName",
        status,
        publications_count AS "publicationsCount",
        leads_count AS "leadsCount",
        matches_count AS "matchesCount",
        received_at AS "receivedAt"
      FROM agent_run_events
      ORDER BY received_at DESC
      LIMIT 1
    `);
    const documentTotals = await pool.query(`
      SELECT
        count(DISTINCT documents.document ->> 'id')
          FILTER (WHERE documents.document ->> 'kind' IN ('property', 'publication'))::int
          AS "uniquePublications",
        count(DISTINCT documents.document ->> 'id')
          FILTER (WHERE documents.document ->> 'kind' = 'lead')::int
          AS "uniqueLeads"
      FROM agent_run_events
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(payload -> 'documents') = 'array' THEN payload -> 'documents'
          ELSE '[]'::jsonb
        END
      ) AS documents(document)
    `);
    const recentRuns = await pool.query(`
      SELECT
        id,
        user_id AS "userId",
        radar_id AS "radarId",
        radar_name AS "radarName",
        status,
        publications_count AS "publicationsCount",
        leads_count AS "leadsCount",
        matches_count AS "matchesCount",
        received_at AS "receivedAt"
      FROM agent_run_events
      ORDER BY received_at DESC
      LIMIT 8
    `);
    const feedbackByKind = await pool.query(`
      SELECT kind, decision, count(*)::int AS count
      FROM client_feedback_events
      GROUP BY kind, decision
      ORDER BY kind, decision
    `);

    response.json({
      ok: true,
      feedback: feedback.rows[0],
      runs: runs.rows[0],
      latestRun: latestRun.rows[0] || null,
      documentTotals: documentTotals.rows[0],
      recentRuns: recentRuns.rows,
      feedbackByKind: feedbackByKind.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/config/summary", async (_request, response, next) => {
  try {
    const [subscriptions, proxyBrokers, inferenceProviders, aiModels, researchTools] =
      await Promise.all([
        pool.query(`
          SELECT email, plan, status, renewal, last_payment AS "lastPayment"
          FROM admin_subscriptions
          ORDER BY created_at DESC
        `),
        pool.query(`
          SELECT name, provider, endpoint, priority, availability, status
          FROM admin_proxy_brokers
          ORDER BY priority ASC, created_at DESC
        `),
        pool.query(`
          SELECT name, token_status AS "tokenStatus", last_token_at AS "lastTokenAt"
          FROM admin_inference_providers
          ORDER BY name ASC
        `),
        pool.query(`
          SELECT name, slug, provider, registered_at AS "registeredAt"
          FROM admin_ai_models
          ORDER BY registered_at DESC
        `),
        pool.query(`
          SELECT name, slug, status, registered_at AS "registeredAt"
          FROM admin_research_tools
          ORDER BY registered_at DESC
        `),
      ]);

    response.json({
      ok: true,
      subscriptions: subscriptions.rows,
      proxyBrokers: proxyBrokers.rows,
      inferenceProviders: inferenceProviders.rows,
      aiModels: aiModels.rows,
      researchTools: researchTools.rows,
      nlpRuntime: {
        provider: process.env.IMMOBILIA_NLP_PROVIDER || "none",
        model: process.env.GEMINI_MODEL || null,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
      proxyRuntime: {
        provider: configuredProxyProvider(),
        mode: proxyRuntimeMode(),
        ttlMinutes: proxyTtlMinutes(),
        serverConfigured: hasConfiguredProxySource(),
      },
      notificationRuntime: {
        provider: "resend",
        configured: Boolean(resendApiKey() && resendFromEmail()),
        fromConfigured: Boolean(resendFromEmail()),
        testRecipientConfigured: Boolean(process.env.RESEND_TO_EMAIL?.trim()),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = error instanceof z.ZodError ? 400 : error instanceof AuthError ? 401 : 500;
  const message = error instanceof Error ? error.message : "Unknown server error";
  response.status(status).json({ ok: false, message });
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_feedback_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      local_created_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_client_feedback_user_received
    ON client_feedback_events (user_id, received_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_client_feedback_kind_decision
    ON client_feedback_events (kind, decision);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      radar_id TEXT NOT NULL,
      radar_name TEXT,
      status TEXT NOT NULL,
      publications_count INTEGER NOT NULL DEFAULT 0,
      leads_count INTEGER NOT NULL DEFAULT 0,
      matches_count INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_run_user_received
    ON agent_run_events (user_id, received_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nlp_extraction_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      source_url TEXT,
      input_text TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_nlp_extraction_user_received
    ON nlp_extraction_events (user_id, received_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proxy_token_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      radar_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_proxy_token_user_received
    ON proxy_token_events (user_id, received_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      recipient TEXT,
      subject TEXT,
      provider_message_id TEXT,
      error TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notification_user_received
    ON notification_events (user_id, received_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_subscriptions (
      email TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      renewal TEXT,
      last_payment TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_proxy_brokers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      availability TEXT,
      status TEXT NOT NULL DEFAULT 'Pendiente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_inference_providers (
      name TEXT PRIMARY KEY,
      token_status TEXT NOT NULL DEFAULT 'Sin configurar',
      last_token_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_models (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_research_tools (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendiente',
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function requireUserId(request: express.Request) {
  const userId = request.header("x-immobilia-user-id")?.trim();
  if (!userId) {
    throw new AuthError("Falta el header x-immobilia-user-id");
  }
  return userId;
}

class AuthError extends Error {}

async function sendAgentRunCompletedNotification(
  userId: string,
  input: z.infer<typeof AgentRunCompletedRequest>
) {
  const recipient = process.env.RESEND_TO_EMAIL?.trim() || input.recipientEmail?.trim();
  const from = resendFromEmail();
  const apiKey = resendApiKey();
  const subject = `Tu Agente WS ${input.radarName || input.radarId} termino su investigacion`;
  const payload = {
    runId: input.runId,
    radarId: input.radarId,
    radarName: input.radarName || null,
    publicationsCount: input.publicationsCount,
    leadsCount: input.leadsCount,
    matchesCount: input.matchesCount,
    finishedAt: input.finishedAt || null,
  };

  if (!input.notifyOnCompletion) {
    await recordNotificationEvent(userId, "agent_run_completed", "skipped", null, subject, null, "notifyOnCompletion=false", payload);
    return { status: "skipped", reason: "notifyOnCompletion=false" };
  }

  if (!apiKey || !from || !recipient) {
    const reason = !apiKey
      ? "RESEND_API_KEY no configurada"
      : !from
        ? "RESEND_FROM_EMAIL no configurado"
        : "Destinatario no configurado";
    await recordNotificationEvent(userId, "agent_run_completed", "skipped", recipient || null, subject, null, reason, payload);
    return { status: "skipped", reason };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Immobil-IA/0.1",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject,
        html: agentRunCompletedHtml(input),
        text: agentRunCompletedText(input),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };

    if (!response.ok) {
      const message = body.message || `Resend respondio ${response.status}`;
      await recordNotificationEvent(userId, "agent_run_completed", "error", recipient, subject, null, message, payload);
      return { status: "error", reason: message };
    }

    await recordNotificationEvent(userId, "agent_run_completed", "sent", recipient, subject, body.id || null, null, payload);
    return { status: "sent", providerMessageId: body.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido enviando correo";
    await recordNotificationEvent(userId, "agent_run_completed", "error", recipient, subject, null, message, payload);
    return { status: "error", reason: message };
  }
}

async function recordNotificationEvent(
  userId: string,
  kind: string,
  status: string,
  recipient: string | null,
  subject: string,
  providerMessageId: string | null,
  error: string | null,
  payload: Record<string, unknown>
) {
  await pool.query(
    `
    INSERT INTO notification_events (
      user_id, kind, status, recipient, subject, provider_message_id, error, payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      userId,
      kind,
      status,
      recipient,
      subject,
      providerMessageId,
      error,
      JSON.stringify(payload),
    ]
  );
}

function agentRunCompletedHtml(input: z.infer<typeof AgentRunCompletedRequest>) {
  const radarName = escapeHtml(input.radarName || input.radarId);
  return [
    `<h1>Tu Agente WS ${radarName} termino su investigacion</h1>`,
    "<p>Resumen de la ultima ejecucion:</p>",
    "<ul>",
    `<li>Publicaciones nuevas: ${input.publicationsCount}</li>`,
    `<li>Leads nuevos: ${input.leadsCount}</li>`,
    `<li>Matches nuevos: ${input.matchesCount}</li>`,
    "</ul>",
    "<p>Ya puedes revisar los resultados en Immobil-IA.</p>",
  ].join("");
}

function agentRunCompletedText(input: z.infer<typeof AgentRunCompletedRequest>) {
  return [
    `Tu Agente WS ${input.radarName || input.radarId} termino su investigacion.`,
    `Publicaciones nuevas: ${input.publicationsCount}`,
    `Leads nuevos: ${input.leadsCount}`,
    `Matches nuevos: ${input.matchesCount}`,
    "Ya puedes revisar los resultados en Immobil-IA.",
  ].join("\n");
}

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

function resendFromEmail() {
  return process.env.RESEND_FROM_EMAIL?.trim() || "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function resolveProxyToken(input: z.infer<typeof ProxyTokenRequest>): Promise<ProxyToken | null> {
  if (configuredProxyProvider() === "webshare") {
    const webshareProxy = await fetchWebshareProxy(input);
    if (webshareProxy) return webshareProxy;
  }

  return configuredStaticProxyToken();
}

function configuredProxyProvider() {
  return (process.env.IMMOBILIA_PROXY_PROVIDER || "static").trim().toLowerCase();
}

function proxyRuntimeMode() {
  if (configuredProxyProvider() === "webshare") {
    return webshareApiKey() ? "webshare" : "direct";
  }
  return configuredStaticProxyToken() ? "static" : "direct";
}

function hasConfiguredProxySource() {
  if (configuredProxyProvider() === "webshare") return Boolean(webshareApiKey());
  return Boolean(configuredStaticProxyToken());
}

function configuredStaticProxyToken(): ProxyToken | null {
  const server =
    process.env.IMMOBILIA_PROXY_SERVER?.trim() ||
    proxyServerFromHostPort(process.env.IMMOBILIA_PROXY_HOST, process.env.IMMOBILIA_PROXY_PORT);

  if (!server) return null;

  const username = process.env.IMMOBILIA_PROXY_USERNAME?.trim();
  const password = process.env.IMMOBILIA_PROXY_PASSWORD?.trim();

  return {
    server,
    username: username || undefined,
    password: password || undefined,
    provider: "static",
  };
}

async function fetchWebshareProxy(_input: z.infer<typeof ProxyTokenRequest>): Promise<ProxyToken | null> {
  const apiKey = webshareApiKey();
  if (!apiKey) return null;

  const url = new URL("https://proxy.webshare.io/api/v2/proxy/list/");
  url.searchParams.set("mode", process.env.WEBSHARE_PROXY_MODE?.trim() || "direct");
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", process.env.WEBSHARE_PAGE_SIZE?.trim() || "25");

  const countryCodes = process.env.WEBSHARE_COUNTRY_CODES?.trim();
  if (countryCodes) {
    url.searchParams.set("country_code__in", countryCodes);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Webshare respondio ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      proxy_address?: string;
      port?: number;
      username?: string;
      password?: string;
      valid?: boolean;
    }>;
  };
  const proxy = payload.results?.find(
    (candidate) => candidate.valid !== false && candidate.proxy_address && candidate.port
  );

  if (!proxy?.proxy_address || !proxy.port) return null;

  const protocol = process.env.WEBSHARE_PROXY_PROTOCOL?.trim() || "http";
  return {
    server: `${protocol}://${proxy.proxy_address}:${proxy.port}`,
    username: proxy.username || undefined,
    password: proxy.password || undefined,
    provider: "webshare",
  };
}

function webshareApiKey() {
  return (
    process.env.WEBSHARE_API_KEY?.trim() ||
    process.env.IMMOBILIA_WEBSHARE_API_KEY?.trim() ||
    ""
  );
}

function proxyServerFromHostPort(host?: string, port?: string) {
  const cleanHost = host?.trim();
  const cleanPort = port?.trim();
  if (!cleanHost || !cleanPort) return undefined;
  const protocol = process.env.IMMOBILIA_PROXY_PROTOCOL?.trim() || "http";
  return `${protocol}://${cleanHost}:${cleanPort}`;
}

function proxyTtlMinutes() {
  const configured = Number(process.env.IMMOBILIA_PROXY_TTL_MINUTES || 20);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function configuredNlpProvider() {
  const provider = process.env.IMMOBILIA_NLP_PROVIDER?.trim().toLowerCase();
  if (provider === "gemini") return "gemini";
  return "local";
}

async function extractWithNlp(
  input: z.infer<typeof NlpExtractRequest>,
  provider: "gemini" | "local"
): Promise<{ provider: "gemini" | "local"; extracted: NlpExtracted }> {
  if (provider === "gemini" && process.env.GEMINI_API_KEY?.trim()) {
    try {
      return {
        provider,
        extracted: await extractWithGemini(input),
      };
    } catch (error) {
      console.warn("Gemini extraction failed; falling back to local extraction", error);
    }
  }

  return {
    provider: "local",
    extracted: extractLocally(input),
  };
}

async function extractWithGemini(input: z.infer<typeof NlpExtractRequest>): Promise<NlpExtracted> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return extractLocally(input);

  const prompt = [
    "Extrae informacion inmobiliaria estructurada del texto en espanol de Colombia.",
    "Devuelve solo JSON valido, sin markdown, con este esquema:",
    `{"kind":"lead|publication|unknown","confidence":0.0,"lead":{},"publication":{}}`,
    "Para lead usa campos posibles: name, role, phone, email, lookingFor, budget, location, rooms, pets.",
    "Para publication usa campos posibles: title, price, location, areaM2, rooms, ownerName, ownerPhone, ownerEmail.",
    `Hint: ${input.hint}. Locale: ${input.locale}. Texto: ${input.text}`,
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini respondio ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini no devolvio texto");

  return normalizeNlpExtraction(JSON.parse(stripJsonFence(text)), input.text);
}

function extractLocally(input: z.infer<typeof NlpExtractRequest>): NlpExtracted {
  const rawText = input.text.replace(/\s+/g, " ").trim();
  const lower = rawText.toLowerCase();
  const price = extractMoney(rawText);
  const rooms = extractIntegerBefore(rawText, /(habitaciones|habitacion|alcobas|cuartos)/i);
  const areaM2 = extractIntegerBefore(rawText, /(m2|mts|metros)/i);
  const location = extractLocation(rawText);
  const isLead =
    input.hint === "lead" ||
    /\b(busco|necesito|quiero|requiero|estoy buscando|interesad[oa])\b/i.test(rawText);
  const isPublication =
    input.hint === "publication" ||
    /\b(se arrienda|arriendo|en arriendo|se vende|vendo|venta|apartamento|casa|oficina)\b/i.test(
      rawText
    );

  if (isLead && input.hint !== "publication") {
    return {
      kind: "lead",
      confidence: 0.72,
      rawText,
      lead: {
        role: /\b(comprar|compro|compra|comprador|comprando|venta|vendo)\b/i.test(rawText)
          ? "Comprador"
          : "Arrendatario",
        lookingFor: rawText,
        budget: price,
        location,
        rooms,
        pets: /\b(perro|gato|mascota|mascotas)\b/i.test(rawText),
      },
    };
  }

  if (isPublication) {
    return {
      kind: "publication",
      confidence: 0.68,
      rawText,
      publication: {
        title: titleFromText(rawText),
        price,
        location,
        areaM2,
        rooms,
      },
    };
  }

  return {
    kind: "unknown",
    confidence: 0.35,
    rawText,
  };
}

function normalizeNlpExtraction(value: unknown, rawText: string): NlpExtracted {
  const record = isRecord(value) ? value : {};
  const kind = record.kind === "lead" || record.kind === "publication" ? record.kind : "unknown";
  const confidence = clampConfidence(Number(record.confidence ?? 0.5));

  return {
    kind,
    confidence,
    rawText,
    lead: isRecord(record.lead) ? record.lead : undefined,
    publication: isRecord(record.publication) ? record.publication : undefined,
  };
}

function stripJsonFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractMoney(text: string) {
  const millionMatch = text.match(/(?:hasta|precio|presupuesto)?\s*\$?\s*(\d+(?:[.,]\d+)?)\s*(?:millones|millon|mm)\b/i);
  if (millionMatch?.[1]) {
    return Math.round(Number(millionMatch[1].replace(",", ".")) * 1_000_000);
  }

  const numberMatch = text.match(/\$?\s*(\d{1,3}(?:[.,]\d{3}){1,3}|\d{7,12})/);
  if (!numberMatch?.[1]) return undefined;
  return Number(numberMatch[1].replace(/[.,]/g, ""));
}

function extractIntegerBefore(text: string, suffix: RegExp) {
  const match = text.match(new RegExp(`(\\d+)\\s*${suffix.source}`, suffix.flags));
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractLocation(text: string) {
  const knownZones = [
    "Chapinero Alto",
    "Chapinero",
    "Usaquen",
    "Cedritos",
    "Santa Barbara",
    "Envigado",
    "Poblado",
    "Laureles",
  ];
  const lower = text.toLowerCase();
  return knownZones.find((zone) => lower.includes(zone.toLowerCase()));
}

function titleFromText(text: string) {
  let title = text.split(/\n/)[0]?.trim() || text.trim();
  const detailMatch = title.match(
    /^(.*?)(?:,\s*)?(?:\d+\s*(?:m2|mts|metros|habitaciones|habitacion|alcobas|cuartos)|precio|\$|contacto|telefono)/i
  );
  if (detailMatch?.[1] && detailMatch[1].trim().length >= 16) {
    title = detailMatch[1].trim();
  }
  return title.length > 90 ? `${title.slice(0, 87)}...` : title;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

migrate()
  .then(() => {
    app.listen(port, () => {
      console.log(`Immobil-IA thin server listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start thin server", error);
    process.exit(1);
  });
