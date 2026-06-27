import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  Bell,
  Brain,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  Gauge,
  Mail,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import "./styles.css";

type Section = "overview" | "subscriptions" | "proxies" | "nlp" | "operations";

type OperationsSummary = {
  feedback: {
    total: number;
    today: number;
  };
  runs: {
    total: number;
    today: number;
    publications: number;
    leads: number;
    matches: number;
  };
  latestRun: {
    id: string;
    userId: string;
    radarId: string;
    radarName?: string;
    status: string;
    publicationsCount: number;
    leadsCount: number;
    matchesCount: number;
    receivedAt: string;
  } | null;
  documentTotals: {
    uniquePublications: number;
    uniqueLeads: number;
  };
  recentRuns: Array<{
    id: string;
    userId: string;
    radarId: string;
    radarName?: string;
    status: string;
    publicationsCount: number;
    leadsCount: number;
    matchesCount: number;
    receivedAt: string;
  }>;
  feedbackByKind: Array<{
    kind: string;
    decision: string;
    count: number;
  }>;
};

type AdminConfigSummary = {
  subscriptions: Array<{
    email: string;
    plan: string;
    status: string;
    renewal?: string;
    lastPayment?: string;
  }>;
  proxyBrokers: Array<{
    name: string;
    provider: string;
    endpoint: string;
    priority: number;
    availability?: string;
    status: string;
  }>;
  inferenceProviders: Array<{
    name: string;
    tokenStatus: string;
    lastTokenAt?: string;
  }>;
  aiModels: Array<{
    name: string;
    slug: string;
    provider: string;
    registeredAt: string;
  }>;
  researchTools: Array<{
    name: string;
    slug: string;
    status: string;
    registeredAt: string;
  }>;
  nlpRuntime: {
    provider: string;
    model?: string | null;
    geminiConfigured: boolean;
  };
  proxyRuntime: {
    provider: string;
    mode: string;
    ttlMinutes: number;
    serverConfigured: boolean;
  };
  notificationRuntime: {
    provider: string;
    configured: boolean;
    fromConfigured: boolean;
    testRecipientConfigured: boolean;
  };
};

const adminApiUrl = (import.meta.env.VITE_IMMOBILIA_ADMIN_API_URL || "http://localhost:3000").replace(/\/$/, "");

function App() {
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummary | undefined>();
  const [configSummary, setConfigSummary] = useState<AdminConfigSummary | undefined>();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>();

  const refreshAdminData = async () => {
    try {
      setIsSyncing(true);
      setSyncError(undefined);
      const [operationsResponse, configResponse] = await Promise.all([
        fetch(`${adminApiUrl}/admin/operations/summary`),
        fetch(`${adminApiUrl}/admin/config/summary`),
      ]);
      if (!operationsResponse.ok) throw new Error(`Operaciones HTTP ${operationsResponse.status}`);
      if (!configResponse.ok) throw new Error(`Configuracion HTTP ${configResponse.status}`);
      const data = (await operationsResponse.json()) as { ok: boolean } & OperationsSummary;
      const config = (await configResponse.json()) as { ok: boolean } & AdminConfigSummary;
      setOperationsSummary({
        feedback: data.feedback,
        runs: data.runs,
        latestRun: data.latestRun,
        documentTotals: data.documentTotals,
        recentRuns: data.recentRuns,
        feedbackByKind: data.feedbackByKind,
      });
      setConfigSummary({
        subscriptions: config.subscriptions,
        proxyBrokers: config.proxyBrokers,
        inferenceProviders: config.inferenceProviders,
        aiModels: config.aiModels,
        researchTools: config.researchTools,
        nlpRuntime: config.nlpRuntime,
        proxyRuntime: config.proxyRuntime,
        notificationRuntime: config.notificationRuntime,
      });
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "No se pudo sincronizar");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    refreshAdminData();
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Server size={30} />
          </div>
          <div>
            <h1>Immobil-IA</h1>
            <p>Admin Web</p>
          </div>
        </div>
        <nav>
          <NavButton active={activeSection === "overview"} icon={<Gauge size={16} />} onClick={() => setActiveSection("overview")}>
            Resumen
          </NavButton>
          <NavButton
            active={activeSection === "subscriptions"}
            icon={<CreditCard size={16} />}
            onClick={() => setActiveSection("subscriptions")}
          >
            Suscripciones
          </NavButton>
          <NavButton active={activeSection === "proxies"} icon={<Network size={16} />} onClick={() => setActiveSection("proxies")}>
            Proxies
          </NavButton>
          <NavButton active={activeSection === "nlp"} icon={<Brain size={16} />} onClick={() => setActiveSection("nlp")}>
            NLP
          </NavButton>
          <NavButton
            active={activeSection === "operations"}
            icon={<ShieldCheck size={16} />}
            onClick={() => setActiveSection("operations")}
          >
            Operacion
          </NavButton>
        </nav>

        <div className="admin-note">
          <strong>Acceso administrativo</strong>
          <p>Seguimiento, mantenimiento y configuracion del sistema. No almacena inventario local de clientes.</p>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Panel administrativo</p>
            <h2>{sectionTitle(activeSection)}</h2>
          </div>
          <button onClick={refreshAdminData} disabled={isSyncing}>
            <RefreshCw size={16} />
            {isSyncing ? "Sincronizando" : "Sincronizar"}
          </button>
        </header>

        <section className="viewport">{renderSection(activeSection, operationsSummary, configSummary, syncError)}</section>
      </main>
    </div>
  );
}

function renderSection(
  section: Section,
  operationsSummary?: OperationsSummary,
  configSummary?: AdminConfigSummary,
  syncError?: string
) {
  if (section === "subscriptions") return <SubscriptionsView data={configSummary} error={syncError} />;
  if (section === "proxies") return <ProxiesView data={configSummary} error={syncError} />;
  if (section === "nlp") return <NlpView data={configSummary} error={syncError} />;
  if (section === "operations") return <OperationsView data={operationsSummary} config={configSummary} error={syncError} />;
  return <OverviewView data={operationsSummary} error={syncError} />;
}

function sectionTitle(section: Section) {
  const titles: Record<Section, string> = {
    overview: "Resumen del sistema",
    subscriptions: "Suscripciones",
    proxies: "Brokers de proxies",
    nlp: "NLP e inferencia",
    operations: "Operacion y mantenimiento",
  };
  return titles[section];
}

function OverviewView({ data, error }: { data?: OperationsSummary; error?: string }) {
  const runs = data?.runs;
  const feedback = data?.feedback;
  const documentTotals = data?.documentTotals;

  return (
    <div className="section-stack">
      {error ? <InlineNotice text={`Thin server no disponible: ${error}`} /> : null}
      <section className="metrics">
        <Metric icon={<Activity size={18} />} label="Investigaciones hoy" value={formatNumber(runs?.today || 0)} />
        <Metric icon={<RefreshCw size={18} />} label="Feedback recibido" value={formatNumber(feedback?.total || 0)} />
        <Metric icon={<Database size={18} />} label="Publicaciones unicas" value={formatNumber(documentTotals?.uniquePublications || 0)} />
        <Metric icon={<Users size={18} />} label="Leads unicos" value={formatNumber(documentTotals?.uniqueLeads || 0)} />
      </section>

      <section className="grid two">
        <Card title="Flujo operativo activo">
          <ol className="flow-list">
            <li>Cliente activa un Agente WS local.</li>
            <li>El cliente solicita proxy y APIs autorizadas al servidor.</li>
            <li>Puppeteer investiga desde el PC del usuario y guarda datos localmente.</li>
            <li>PostComparer genera comparaciones HITL entre publicaciones.</li>
            <li>MatchMaker cruza inmuebles disponibles con leads.</li>
            <li>Se notifica al usuario localmente y por correo via Resend.</li>
          </ol>
        </Card>

        <Card title="Estado de modelos">
          <div className="stack">
            <StatusRow label="PostComparer" value="v0.1.8 publicado" status="Activo" />
            <StatusRow label="MatchMaker" value="v0.1.4 publicado" status="Activo" />
            <StatusRow
              label="Feedback training set"
              value={`${formatNumber(feedback?.total || 0)} eventos recibidos`}
              status={(feedback?.total || 0) > 0 ? "Activo" : "Pendiente"}
            />
            <StatusRow
              label="Documentos unicos observados"
              value={`${formatNumber(documentTotals?.uniquePublications || 0)} publicaciones, ${formatNumber(
                documentTotals?.uniqueLeads || 0
              )} leads`}
              status={(documentTotals?.uniquePublications || documentTotals?.uniqueLeads || 0) > 0 ? "Activo" : "Pendiente"}
            />
          </div>
        </Card>
      </section>
    </div>
  );
}

function SubscriptionsView({ data, error }: { data?: AdminConfigSummary; error?: string }) {
  const subscriptions = data?.subscriptions || [];
  return (
    <div className="section-stack">
      {error ? <InlineNotice text={`Thin server no disponible: ${error}`} /> : null}
      <Card title="Usuarios y suscripciones">
        <Table>
          <thead>
            <tr>
              <th>Correo</th>
              <th>Nivel</th>
              <th>Estado</th>
              <th>Renovacion</th>
              <th>Ultimo pago</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((subscription) => (
              <tr key={subscription.email}>
                <td>{subscription.email}</td>
                <td>{subscription.plan}</td>
                <td>
                  <Badge tone={subscription.status === "Activa" ? "success" : subscription.status === "Vencida" ? "warning" : "muted"}>
                    {subscription.status}
                  </Badge>
                </td>
                <td>{subscription.renewal || "Sin registrar"}</td>
                <td>{subscription.lastPayment ? formatDateTime(subscription.lastPayment) : "Sin registrar"}</td>
                <td>
                  <SubscriptionActions active={subscription.status === "Activa"} />
                </td>
              </tr>
            ))}
            {!subscriptions.length ? <EmptyTableRow colSpan={6} text="Sin suscripciones registradas en el thin server." /> : null}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function ProxiesView({ data, error }: { data?: AdminConfigSummary; error?: string }) {
  const proxyBrokers = data?.proxyBrokers || [];
  const runtime = data?.proxyRuntime;
  return (
    <div className="section-stack">
      {error ? <InlineNotice text={`Thin server no disponible: ${error}`} /> : null}
      <Card title="Runtime proxy activo">
        <div className="stack">
          <StatusRow
            label="Proveedor broker"
            value={runtime?.provider || "static"}
            status={runtime?.serverConfigured ? "Activo" : "Pendiente"}
          />
          <StatusRow
            label="Modo de salida"
            value={runtime?.mode || "direct"}
            status={runtime?.serverConfigured ? "Activo" : "Pendiente"}
          />
          <StatusRow
            label="TTL credencial"
            value={runtime?.serverConfigured ? `${runtime.ttlMinutes} minutos` : "Sin proxy configurado"}
            status={runtime?.serverConfigured ? "Activo" : "Pendiente"}
          />
        </div>
      </Card>
      <div className="action-row">
        <p>El sistema elige brokers por prioridad y disponibilidad. Si uno falla, usa el siguiente disponible.</p>
        <button disabled>
          <Plus size={16} />
          Registrar broker
        </button>
      </div>
      <Card title="Brokers registrados">
        <Table>
          <thead>
            <tr>
              <th>Broker</th>
              <th>Proveedor</th>
              <th>Endpoint</th>
              <th>Prioridad</th>
              <th>Disponibilidad</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {proxyBrokers.map((broker) => (
              <tr key={broker.name}>
                <td>{broker.name}</td>
                <td>{broker.provider}</td>
                <td>{broker.endpoint}</td>
                <td>{broker.priority}</td>
                <td>{broker.availability || "Sin telemetria"}</td>
                <td>
                  <Badge tone={broker.status === "Disponible" ? "success" : "muted"}>{broker.status}</Badge>
                </td>
                <td>
                  <TableActions />
                </td>
              </tr>
            ))}
            {!proxyBrokers.length ? <EmptyTableRow colSpan={7} text="Sin brokers de proxy registrados en Postgres." /> : null}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function NlpView({ data, error }: { data?: AdminConfigSummary; error?: string }) {
  const inferenceProviders = data?.inferenceProviders || [];
  const aiModels = data?.aiModels || [];
  const researchTools = data?.researchTools || [];
  const runtime = data?.nlpRuntime;

  return (
    <div className="section-stack">
      {error ? <InlineNotice text={`Thin server no disponible: ${error}`} /> : null}
      <Card title="Runtime NLP activo">
        <div className="stack">
          <StatusRow
            label="Proveedor configurado"
            value={runtime?.provider || "none"}
            status={runtime?.provider && runtime.provider !== "none" ? "Activo" : "Pendiente"}
          />
          <StatusRow
            label="Modelo Gemini"
            value={runtime?.model || "Sin configurar"}
            status={runtime?.geminiConfigured ? "Activo" : "Pendiente"}
          />
          <StatusRow
            label="Clave Gemini"
            value={runtime?.geminiConfigured ? "Configurada en entorno" : "No configurada"}
            status={runtime?.geminiConfigured ? "Activo" : "Pendiente"}
          />
        </div>
      </Card>

      <Card title="APIs de proveedores de inferencia">
        <p className="card-copy">
          Los parametros de temperatura, system prompts, user prompts y herramientas internas estan preconfigurados en
          el servidor. El administrador solo registra tokens.
        </p>
        <Table>
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Estado del token</th>
              <th>Ultimo token registrado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {inferenceProviders.map((provider) => (
              <tr key={provider.name}>
                <td>{provider.name}</td>
                <td>
                  <Badge tone={provider.tokenStatus === "Activo" ? "success" : "muted"}>{provider.tokenStatus}</Badge>
                </td>
                <td>{provider.lastTokenAt ? formatDateTime(provider.lastTokenAt) : "Sin registrar"}</td>
                <td>
                  <TableActions />
                </td>
              </tr>
            ))}
            {!inferenceProviders.length ? <EmptyTableRow colSpan={4} text="Sin proveedores guardados en Postgres." /> : null}
          </tbody>
        </Table>
      </Card>

      <div className="action-row">
        <p>Los modelos se registran por slug interno. La configuracion de prompts y temperatura queda fija en backend.</p>
        <button disabled>
          <Plus size={16} />
          Registrar modelo IA
        </button>
      </div>
      <Card title="Modelos de IA registrados">
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Slug</th>
              <th>Proveedor</th>
              <th>Fecha de registro</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {aiModels.map((model) => (
              <tr key={model.slug}>
                <td>{model.name}</td>
                <td>
                  <code>{model.slug}</code>
                </td>
                <td>{model.provider}</td>
                <td>{formatDateTime(model.registeredAt)}</td>
                <td>
                  <TableActions />
                </td>
              </tr>
            ))}
            {!aiModels.length ? <EmptyTableRow colSpan={5} text="Sin modelos IA registrados en Postgres." /> : null}
          </tbody>
        </Table>
      </Card>

      <div className="action-row">
        <p>Las herramientas quedan disponibles para los Agentes WS segun permisos y plan del cliente.</p>
        <button disabled>
          <Plus size={16} />
          Registrar herramienta
        </button>
      </div>
      <Card title="Herramientas disponibles para Agentes WS">
        <Table>
          <thead>
            <tr>
              <th>Herramienta</th>
              <th>Slug</th>
              <th>Estado</th>
              <th>Fecha de registro</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {researchTools.map((tool) => (
              <tr key={tool.slug}>
                <td>{tool.name}</td>
                <td>
                  <code>{tool.slug}</code>
                </td>
                <td>
                  <Badge tone={tool.status === "Activo" ? "success" : "warning"}>{tool.status}</Badge>
                </td>
                <td>{formatDateTime(tool.registeredAt)}</td>
                <td>
                  <TableActions />
                </td>
              </tr>
            ))}
            {!researchTools.length ? <EmptyTableRow colSpan={5} text="Sin herramientas registradas en Postgres." /> : null}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function OperationsView({ data, config, error }: { data?: OperationsSummary; config?: AdminConfigSummary; error?: string }) {
  const operationMetrics = [
    { label: "Investigaciones WS completadas hoy", value: formatNumber(data?.runs.today || 0), icon: <Activity size={18} /> },
    { label: "Publicaciones unicas", value: formatNumber(data?.documentTotals.uniquePublications || 0), icon: <Database size={18} /> },
    { label: "Leads unicos", value: formatNumber(data?.documentTotals.uniqueLeads || 0), icon: <Users size={18} /> },
    { label: "Feedback HITL recibido", value: formatNumber(data?.feedback.total || 0), icon: <RefreshCw size={18} /> },
  ];

  return (
    <div className="section-stack">
      {error ? <InlineNotice text={`Thin server no disponible: ${error}`} /> : null}
      <section className="metrics">
        {operationMetrics.map((item) => (
          <Metric key={item.label} icon={item.icon} label={item.label} value={item.value} />
        ))}
      </section>
      <section className="grid two">
        <NotificationRuntimeView data={config} />
        <Card title="Investigaciones recientes">
          <Table>
            <thead>
              <tr>
                <th>Radar</th>
                <th>Estado</th>
              <th>Publicaciones</th>
              <th>Leads</th>
              <th>Matches</th>
              <th>Recibido</th>
            </tr>
          </thead>
            <tbody>
              {(data?.recentRuns || []).map((run) => (
                <tr key={run.id}>
                  <td>{run.radarName || run.radarId}</td>
                  <td><Badge tone={run.status === "completed" ? "success" : "warning"}>{run.status}</Badge></td>
                  <td>{run.publicationsCount}</td>
                  <td>{run.leadsCount}</td>
                  <td>{run.matchesCount}</td>
                  <td>{formatDateTime(run.receivedAt)}</td>
                </tr>
              ))}
              {!data?.recentRuns.length ? (
                <tr>
                  <td colSpan={6}>Sin investigaciones sincronizadas todavia.</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
        <Card title="Totales deduplicados">
          <div className="stack">
            <StatusRow
              label="Publicaciones unicas"
              value={formatNumber(data?.documentTotals.uniquePublications || 0)}
              status={(data?.documentTotals.uniquePublications || 0) > 0 ? "Activo" : "Pendiente"}
            />
            <StatusRow
              label="Leads unicos"
              value={formatNumber(data?.documentTotals.uniqueLeads || 0)}
              status={(data?.documentTotals.uniqueLeads || 0) > 0 ? "Activo" : "Pendiente"}
            />
            <StatusRow
              label="Conteo historico de corridas"
              value={`${formatNumber(data?.runs.publications || 0)} publicaciones, ${formatNumber(data?.runs.leads || 0)} leads`}
              status={(data?.runs.total || 0) > 0 ? "Activo" : "Pendiente"}
            />
          </div>
        </Card>
        <Card title="Feedback HITL">
          <div className="action-row compact">
            <p>Eventos HITL listos para auditoria o entrenamiento supervisado.</p>
            <button onClick={downloadFeedbackExport}>
              <Download size={16} />
              Exportar JSONL
            </button>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Decision</th>
                <th>Eventos</th>
              </tr>
            </thead>
            <tbody>
              {(data?.feedbackByKind || []).map((item) => (
                <tr key={`${item.kind}-${item.decision}`}>
                  <td>{labelFeedbackKind(item.kind)}</td>
                  <td>{item.decision}</td>
                  <td>{formatNumber(item.count)}</td>
                </tr>
              ))}
              {!data?.feedbackByKind.length ? (
                <tr>
                  <td colSpan={3}>Sin feedback sincronizado todavia.</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

function NotificationRuntimeView({ data }: { data?: AdminConfigSummary }) {
  const runtime = data?.notificationRuntime;
  return (
    <Card title="Runtime notificaciones">
      <div className="stack">
        <StatusRow
          label="Proveedor"
          value={runtime?.provider || "resend"}
          status={runtime?.configured ? "Activo" : "Pendiente"}
        />
        <StatusRow
          label="Remitente"
          value={runtime?.fromConfigured ? "Configurado" : "Sin configurar"}
          status={runtime?.fromConfigured ? "Activo" : "Pendiente"}
        />
        <StatusRow
          label="Destinatario de prueba"
          value={runtime?.testRecipientConfigured ? "Configurado" : "Usa email del usuario"}
          status={runtime?.configured ? "Activo" : "Pendiente"}
        />
      </div>
    </Card>
  );
}

function InlineNotice({ text }: { text: string }) {
  return <div className="inline-notice">{text}</div>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function labelFeedbackKind(kind: string) {
  if (kind === "matchmaker_match") return "MatchMaker";
  if (kind === "post_comparer_relation") return "PostComparer";
  if (kind === "manual_property_relation") return "Relacion manual";
  return kind;
}

function downloadFeedbackExport() {
  window.open(`${adminApiUrl}/admin/feedback/export`, "_blank", "noopener,noreferrer");
}

function NavButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <div>{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return <div className="table-wrap"><table>{children}</table></div>;
}

function EmptyTableRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td className="empty-cell" colSpan={colSpan}>
        {text}
      </td>
    </tr>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "success" | "warning" | "muted" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function TableActions() {
  return (
    <div className="table-actions">
      <button className="icon-button" aria-label="Editar">
        <PenLine size={15} />
      </button>
      <button className="icon-button danger" aria-label="Eliminar">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function SubscriptionActions({ active }: { active: boolean }) {
  return (
    <div className="table-actions">
      <button className="icon-button" aria-label={active ? "Desactivar suscripcion" : "Activar suscripcion"}>
        {active ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
      </button>
      <button className="icon-button danger" aria-label="Eliminar usuario">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function StatusRow({ label, value, status }: { label: string; value: string; status: "Activo" | "Pendiente" }) {
  return (
    <div className="row-card">
      <div>
        <strong>{label}</strong>
        <p>{value}</p>
      </div>
      <span className={status === "Activo" ? "status-ok" : "status-warning"}>
        {status === "Activo" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        {status}
      </span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
