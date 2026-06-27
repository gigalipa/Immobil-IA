import { Check, ChevronLeft, ChevronRight, Clipboard, Mail, MessageCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "./ui/Button";
import { EntityLink } from "./EntityViews";
import { renderTemplate } from "../lib/templateRenderer";
import type {
  DemandDistributionPoint,
  Lead,
  MatchSuggestion,
  MessageTemplate,
  Property,
  RadarActivityPoint,
  UserProfile,
} from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/utils";

type MorningBriefingProps = {
  matches: MatchSuggestion[];
  template?: MessageTemplate;
  user?: UserProfile;
  onDecision: (id: string, status: MatchSuggestion["status"]) => Promise<void>;
  onOpenLead: (id: string) => void;
  onOpenProperty: (id: string) => void;
  radarActivity: RadarActivityPoint[];
  demandDistribution: DemandDistributionPoint[];
};

const demandColors = ["#047857", "#14b8a6", "#f59e0b"];

export function MorningBriefing({
  matches,
  template,
  user,
  onDecision,
  onOpenLead,
  onOpenProperty,
  radarActivity,
  demandDistribution,
}: MorningBriefingProps) {
  const priorityMatches = [...matches]
    .filter((match) => match.status === "Pendiente" && match.comparisonProperty)
    .sort((a, b) => b.similarity.confidence - a.similarity.confidence)
    .slice(0, 5);

  const scrollCarousel = (direction: "left" | "right") => {
    const carousel = document.getElementById("hitl-carousel");
    if (!carousel) return;
    carousel.scrollBy({ left: direction === "left" ? -620 : 620, behavior: "smooth" });
  };

  return (
    <section className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <section className="relative overflow-hidden rounded-lg border border-border bg-white p-5 shadow-panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Validacion HITL</h1>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
              {priorityMatches.length} pendientes
            </span>
          </div>

          <Button
            aria-label="Anterior"
            className="absolute left-4 top-1/2 z-10 rounded-full bg-white shadow-panel"
            size="icon"
            variant="secondary"
            onClick={() => scrollCarousel("left")}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            aria-label="Siguiente"
            className="absolute right-4 top-1/2 z-10 rounded-full bg-white shadow-panel"
            size="icon"
            variant="secondary"
            onClick={() => scrollCarousel("right")}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>

          <div
            className="flex snap-x gap-8 overflow-x-auto scroll-smooth px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            id="hitl-carousel"
          >
            {priorityMatches.length ? (
              priorityMatches.map((match) => (
                <SimilarityCarouselCard
                  key={match.id}
                  match={match}
                  onDecision={onDecision}
                  onOpenLead={onOpenLead}
                  onOpenProperty={onOpenProperty}
                />
              ))
            ) : (
              <div className="grid min-h-64 min-w-full place-items-center rounded-lg border border-dashed border-border bg-muted px-6 text-center text-sm text-muted-foreground">
                Ejecuta un radar o agrega datos manuales para ver validaciones HITL.
              </div>
            )}
          </div>
        </section>

        <aside className="grid gap-4">
          <MarketChartCard title="Actividad del Radar">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={radarActivity}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip cursor={{ fill: "rgba(4, 120, 87, 0.08)" }} />
                <Bar dataKey="publications" fill="#047857" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </MarketChartCard>
          <MarketChartCard title="Distribucion de Demanda">
            <div className="grid items-center gap-4 sm:grid-cols-[0.8fr_1fr]">
              <div className="grid gap-3 text-sm">
                {demandDistribution.map((entry, index) => (
                  <div className="flex items-center gap-2" key={entry.name}>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: demandColors[index % demandColors.length] }}
                    />
                    <span className="text-muted-foreground">{entry.name}</span>
                    <span className="font-medium">{entry.value}%</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={demandDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={82}
                    paddingAngle={3}
                  >
                    {demandDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={demandColors[index % demandColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </MarketChartCard>
        </aside>
      </div>

      <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
        <div>
          <h2 className="text-xl font-semibold">Feed de prospeccion y contacto</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A quien llamar hoy, con acciones directas y plantilla precompletada.
          </p>
        </div>
        <ProspectingTable
          matches={matches}
          template={template}
          user={user}
          onDecision={onDecision}
          onOpenLead={onOpenLead}
          onOpenProperty={onOpenProperty}
        />
      </section>
    </section>
  );
}

function SimilarityCarouselCard({
  match,
  onDecision,
  onOpenLead,
  onOpenProperty,
}: {
  match: MatchSuggestion;
  onDecision: (id: string, status: MatchSuggestion["status"]) => Promise<void>;
  onOpenLead: (id: string) => void;
  onOpenProperty: (id: string) => void;
}) {
  const comparison = match.comparisonProperty || match.property;

  return (
    <article className="grid min-w-[500px] snap-start gap-4 rounded-lg border border-border p-4 md:min-w-[620px]">
      <div className="grid items-start gap-4 md:grid-cols-[1fr_100px_1fr]">
        <PublicationColumn label="Publicacion A" property={match.property} onOpenProperty={onOpenProperty} />
        <div className="grid justify-items-center gap-3 self-center">
          <ConfidenceDonut value={match.similarity.confidence} />
          <div className="grid w-full grid-cols-3 gap-1 text-center text-[10px] text-muted-foreground">
            <span>GPS {formatPercent(match.similarity.gps)}</span>
            <span>Visual {formatPercent(match.similarity.visual)}</span>
            <span>Datos {formatPercent(match.similarity.features)}</span>
          </div>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            Posible propietario/contacto:<br />
            <EntityLink onClick={() => onOpenLead(match.lead.id)}>{match.lead.name}</EntityLink>
          </p>
        </div>
        <PublicationColumn label="Publicacion B" property={comparison} onOpenProperty={onOpenProperty} />
      </div>

      <div className="flex justify-center gap-3">
        <Button aria-label="Rechazar" size="icon" variant="danger" onClick={() => onDecision(match.id, "Rechazado")}>
          <X className="h-5 w-5" />
        </Button>
        <Button aria-label="Confirmar Match" size="icon" onClick={() => onDecision(match.id, "Confirmado")}>
          <Check className="h-5 w-5" />
        </Button>
      </div>
    </article>
  );
}

function PublicationColumn({
  label,
  property,
  onOpenProperty,
}: {
  label: string;
  property: Property;
  onOpenProperty: (id: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
        <EntityLink onClick={() => onOpenProperty(property.id)}>{property.title}</EntityLink>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Precio</dt>
        <dd className="text-right font-semibold">{formatCurrency(property.price)}</dd>
        <dt className="text-muted-foreground">Area</dt>
        <dd className="text-right font-semibold">{property.areaM2} m2</dd>
        <dt className="text-muted-foreground">Zona</dt>
        <dd className="text-right font-semibold">{property.location}</dd>
      </dl>
      <img alt={property.title} className="h-36 w-full rounded-md object-cover" src={property.imageUrl} />
      <div>
        <p className="text-xs text-muted-foreground">Descripcion</p>
        <p className="mt-1 line-clamp-3 text-xs leading-4">
          {property.title}. Cuenta con ubicacion aproximada, datos de precio, area y fuente detectada por el radar.
        </p>
      </div>
    </div>
  );
}

function ConfidenceDonut({ value }: { value: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative h-20 w-20">
      <svg className="-rotate-90" height="80" viewBox="0 0 80 80" width="80">
        <circle cx="40" cy="40" fill="none" r={radius} stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          fill="none"
          r={radius}
          stroke="#047857"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="8"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-lg font-semibold text-primary">{formatPercent(value)}</p>
          <p className="text-[8px] uppercase text-muted-foreground">seguridad</p>
        </div>
      </div>
    </div>
  );
}

function ProspectingTable({
  matches,
  template,
  user,
  onDecision,
  onOpenLead,
  onOpenProperty,
}: {
  matches: MatchSuggestion[];
  template?: MessageTemplate;
  user?: UserProfile;
  onDecision: (id: string, status: MatchSuggestion["status"]) => Promise<void>;
  onOpenLead: (id: string) => void;
  onOpenProperty: (id: string) => void;
}) {
  const rows = [...matches]
    .filter((match) => match.status !== "Rechazado" && isMatchMakerMatch(match))
    .reduce<MatchSuggestion[]>((deduped, match) => {
      const key = prospectingKey(match);
      const existingIndex = deduped.findIndex((item) => prospectingKey(item) === key);
      if (existingIndex === -1) return [...deduped, match];
      if (isBetterProspectingMatch(match, deduped[existingIndex])) {
        return deduped.map((item, index) => (index === existingIndex ? match : item));
      }
      return deduped;
    }, [])
    .sort((a, b) => b.similarity.confidence - a.similarity.confidence)
    .slice(0, 6);

  if (!rows.length) {
    return (
      <div className="mt-5 rounded-lg border border-dashed border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
        Sin oportunidades por contactar todavia.
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-3 pr-4">Prospecto</th>
            <th className="py-3 pr-4">Tramite</th>
            <th className="py-3 pr-4">Inmueble asociado</th>
            <th className="py-3 pr-4">Zona</th>
            <th className="py-3 pr-4">Certeza</th>
            <th className="py-3 pr-4">Estado</th>
            <th className="py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((match) => {
            const body = template ? renderTemplate(template, { lead: match.lead, property: match.property, user }) : "";
            const phone = match.lead.phone?.replace(/\D/g, "");
            const whatsappHref = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(body)}` : undefined;
            const mailHref = match.lead.email
              ? `mailto:${match.lead.email}?subject=${encodeURIComponent("Sobre tu busqueda inmobiliaria")}&body=${encodeURIComponent(body)}`
              : undefined;

            return (
              <tr className="border-b border-border last:border-0" key={match.id}>
                <td className="py-3 pr-4">
                  <EntityLink onClick={() => onOpenLead(match.lead.id)}>{match.lead.name}</EntityLink>
                  <p className="text-xs text-muted-foreground">{match.lead.phone || match.lead.email}</p>
                </td>
                <td className="py-3 pr-4">{inferTransaction(match.lead.lookingFor)}</td>
                <td className="py-3 pr-4">
                  <EntityLink onClick={() => onOpenProperty(match.property.id)}>{match.property.title}</EntityLink>
                </td>
                <td className="py-3 pr-4">{match.property.location}</td>
                <td className="py-3 pr-4">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                    {formatPercent(match.similarity.confidence)}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      match.status === "Confirmado"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {match.status}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      aria-label="Abrir WhatsApp"
                      disabled={!whatsappHref}
                      size="icon"
                      variant="secondary"
                      onClick={() => whatsappHref && window.open(whatsappHref, "_blank")}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="Abrir correo"
                      disabled={!mailHref}
                      size="icon"
                      variant="secondary"
                      onClick={() => mailHref && window.open(mailHref)}
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="Copiar plantilla"
                      size="icon"
                      variant="secondary"
                      onClick={() => navigator.clipboard.writeText(body)}
                    >
                      <Clipboard className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="Rechazar sugerencia"
                      size="icon"
                      variant="danger"
                      onClick={() => onDecision(match.id, "Rechazado")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="Aprobar sugerencia"
                      size="icon"
                      onClick={() => onDecision(match.id, "Confirmado")}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function isMatchMakerMatch(match: MatchSuggestion) {
  return match.source === "MatchMaker" || (!match.source && !match.comparisonProperty);
}

function prospectingKey(match: MatchSuggestion) {
  const propertyKey =
    match.property.propertyGroupId ||
    match.property.publicationIds?.slice().sort().join("|") ||
    ownerBackedPropertyKey(match) ||
    match.property.id;

  return `${match.lead.id}::${propertyKey}`;
}

function ownerBackedPropertyKey(match: MatchSuggestion) {
  if (match.property.ownerPhone) {
    return [match.property.ownerPhone, match.property.location, match.property.rooms].join("|");
  }

  return [
    match.property.location,
    match.property.rooms,
    Math.round((match.property.price || 0) / 250000) * 250000,
  ]
    .filter(Boolean)
    .join("|");
}

function isBetterProspectingMatch(candidate: MatchSuggestion, current: MatchSuggestion) {
  const confidenceDelta = candidate.similarity.confidence - current.similarity.confidence;
  if (Math.abs(confidenceDelta) > 5) return confidenceDelta > 0;
  return representativeScore(candidate.property) > representativeScore(current.property);
}

function representativeScore(property: Property) {
  return (
    (property.areaM2 || 0) * 2 +
    (property.price || 0) / 100000 +
    (property.ownerPhone ? 10 : 0) +
    (property.imageUrl ? 5 : 0)
  );
}

function MarketChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-5 shadow-panel">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function inferTransaction(text: string) {
  const normalized = text.toLowerCase();
  if (normalized.includes("alquiler") || normalized.includes("arriendo")) {
    return "Alquiler";
  }
  return "Compra";
}
