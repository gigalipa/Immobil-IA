import { ExternalLink, Layers3, Mail, MapPin, Phone, Ruler, ShieldCheck, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui/Button";
import type { Lead, PropertyGroup } from "../lib/types";
import { api } from "../lib/api";
import { formatCurrency, formatPercent } from "../lib/utils";

type EntityViewProps = {
  propertyGroups: PropertyGroup[];
  leads: Lead[];
  focusedPropertyId?: string;
  focusedLeadId?: string;
  onRelateGroups: (firstGroupId: string, secondGroupId: string) => void;
  onOpenProperty: (id: string) => void;
};

export function PropertiesView({
  propertyGroups,
  focusedPropertyId,
  onRelateGroups,
}: Pick<EntityViewProps, "propertyGroups" | "focusedPropertyId" | "onRelateGroups">) {
  const [relatingGroupId, setRelatingGroupId] = useState<string | undefined>();
  const [targetGroupId, setTargetGroupId] = useState<string>("");

  return (
    <section className="grid gap-4">
      <ViewHeader
        title="Inmuebles"
        description="Entidades consolidadas a partir de una o varias publicaciones detectadas por el Agente WS."
      />
      {!propertyGroups.length ? <EmptyState text="No hay publicaciones guardadas todavia." /> : null}
      <div className="grid gap-3 xl:grid-cols-2">
        {propertyGroups.map((group) => {
          const focused = group.publications.some((publication) => publication.id === focusedPropertyId);
          const availableTargets = propertyGroups.filter((candidate) => candidate.id !== group.id);

          return (
          <article
            className={`grid gap-4 rounded-lg border bg-white p-4 shadow-sm transition sm:grid-cols-[150px_1fr] ${
              focused ? "border-primary ring-2 ring-emerald-100" : "border-border"
            }`}
            id={`property-group-${group.id}`}
            key={group.id}
          >
            <img
              alt={group.title}
              className="h-36 w-full rounded-md object-cover"
              src={group.representative.imageUrl}
            />
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{group.title}</h2>
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {group.location}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    group.status === "Confirmado"
                      ? "bg-emerald-50 text-emerald-800"
                      : group.status === "Pendiente HITL"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {group.status}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <Stat label="Publicaciones" icon={<Layers3 className="h-3 w-3" />} value={String(group.publications.length)} />
                <Stat
                  label="Certeza"
                  icon={<ShieldCheck className="h-3 w-3" />}
                  value={group.certainty === undefined ? "N/A" : formatPercent(group.certainty)}
                />
                <Stat label="Precio ref." icon={<Ruler className="h-3 w-3" />} value={formatCurrency(group.representative.price)} />
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <UserRound className="h-3.5 w-3.5" />
                  {group.representative.ownerName || "Propietario no identificado"}
                </span>
                {group.representative.ownerPhone ? (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {group.representative.ownerPhone}
                  </span>
                ) : null}
              </div>
              <details className="mt-4 rounded-md border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Ver publicaciones relacionadas</summary>
                <div className="mt-3 grid gap-2">
                  {group.publications.map((publication) => {
                    const publicationUrl = publication.url || publication.sourceUrl;
                    return (
                    <div className="flex items-center justify-between gap-3 text-muted-foreground" key={publication.id}>
                      <span>{publication.title}</span>
                      {publicationUrl ? (
                        <button
                          className="flex items-center gap-1 font-medium text-primary"
                          onClick={() => openExternalUrl(publicationUrl)}
                        >
                          Abrir
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </details>

              <div className="mt-4 grid gap-2">
                {relatingGroupId === group.id ? (
                  <div className="grid gap-2 rounded-md border border-border bg-muted p-3 sm:grid-cols-[1fr_auto_auto]">
                    <select
                      className="h-9 rounded-md border border-border bg-white px-3 text-sm"
                      value={targetGroupId}
                      onChange={(event) => setTargetGroupId(event.target.value)}
                    >
                      <option value="">Seleccionar inmueble</option>
                      {availableTargets.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title} ({candidate.publications.length} pub.)
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!targetGroupId}
                      onClick={() => {
                        onRelateGroups(group.id, targetGroupId);
                        setRelatingGroupId(undefined);
                        setTargetGroupId("");
                      }}
                    >
                      Relacionar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRelatingGroupId(undefined);
                        setTargetGroupId("");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setRelatingGroupId(group.id)}>
                    Relacionar con otro inmueble
                  </Button>
                )}
              </div>
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

export function LeadsView({
  leads,
  focusedLeadId,
  propertyGroups,
  onOpenProperty,
}: Pick<EntityViewProps, "leads" | "focusedLeadId" | "propertyGroups" | "onOpenProperty">) {
  return (
    <section className="grid gap-4">
      <ViewHeader
        title="Leads"
        description="Personas detectadas por el Agente WS, clasificadas por rol e intencion inmobiliaria."
      />
      {!leads.length ? <EmptyState text="No hay leads guardados todavia." /> : null}
      <div className="rounded-lg border border-border bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Inmueble</th>
                <th className="px-4 py-3">Zona</th>
                <th className="px-4 py-3">Presupuesto</th>
                <th className="px-4 py-3">Contacto</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const role = lead.role || inferLeadRole(lead.lookingFor);
                const isSupply = role === "Propietario" || role === "Arrendador";
                const propertyGroup = lead.propertyId
                  ? propertyGroups.find((group) =>
                      group.publications.some((publication) => publication.id === lead.propertyId)
                    )
                  : undefined;
                const budget = isSupply
                  ? lead.budget || propertyGroup?.representative.price || 0
                  : lead.budget;

                return (
                  <tr
                    className={`border-b border-border last:border-0 ${
                      focusedLeadId === lead.id ? "bg-emerald-50" : ""
                    }`}
                    id={`lead-${lead.id}`}
                    key={lead.id}
                  >
                    <td className="px-4 py-4">
                      <p className="font-semibold">{lead.name}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          isSupply ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {role}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-4">
                      {isSupply && propertyGroup && lead.propertyId ? (
                        <EntityLink onClick={() => onOpenProperty(lead.propertyId || propertyGroup.representative.id)}>
                          {propertyGroup.title}
                        </EntityLink>
                      ) : (
                        <span>{lead.propertySummary || summarizeDemand(lead.lookingFor)}</span>
                      )}
                    </td>
                    <td className="px-4 py-4">{lead.location}</td>
                    <td className="px-4 py-4 font-medium">{budget ? formatCurrency(budget) : "N/A"}</td>
                    <td className="px-4 py-4">
                      <ContactStack lead={lead} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ContactStack({ lead }: { lead: Lead }) {
  return (
    <div className="grid gap-1 text-muted-foreground">
      {lead.phone ? (
        <span className="flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" />
          {lead.phone}
        </span>
      ) : null}
      {lead.email ? (
        <span className="flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" />
          {lead.email}
        </span>
      ) : null}
      {lead.address ? (
        <span className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" />
          {lead.address}
        </span>
      ) : null}
      {!lead.phone && !lead.email && !lead.address ? <span>Sin datos disponibles</span> : null}
    </div>
  );
}

function inferLeadRole(text: string): NonNullable<Lead["role"]> {
  const normalized = text.toLowerCase();
  if (normalized.includes("arrienda") || normalized.includes("arriendo disponible")) return "Arrendador";
  if (normalized.includes("vende") || normalized.includes("venta directa")) return "Propietario";
  if (normalized.includes("alquiler") || normalized.includes("arriendo")) return "Arrendatario";
  return "Comprador";
}

function summarizeDemand(text: string) {
  return text
    .replace(/para compra/gi, "")
    .replace(/para alquiler/gi, "")
    .trim();
}

export function EntityLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={onClick}>
      {children}
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

function ViewHeader({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function openExternalUrl(url: string) {
  if (!("__TAURI_INTERNALS__" in window)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  api.openExternalUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}
