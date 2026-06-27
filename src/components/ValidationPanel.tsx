import { Check, Copy, ExternalLink, Mail, MessageCircle, X } from "lucide-react";
import { Button } from "./ui/Button";
import { renderTemplate } from "../lib/templateRenderer";
import type { MatchSuggestion, MessageTemplate, UserProfile } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/utils";

type ValidationPanelProps = {
  matches: MatchSuggestion[];
  template?: MessageTemplate;
  user?: UserProfile;
  onDecision: (id: string, status: MatchSuggestion["status"]) => Promise<void>;
};

const weights = [
  { key: "gps", label: "Ubicacion GPS", weight: "30%" },
  { key: "visual", label: "Hash visual", weight: "40%" },
  { key: "features", label: "Caracteristicas", weight: "30%" },
] as const;

export function ValidationPanel({ matches, template, user, onDecision }: ValidationPanelProps) {
  return (
    <section className="grid gap-4" id="validacion">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Panel de Validacion HITL</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA sugiere coincidencias; el asesor confirma o rechaza antes de contactar.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm">
          {matches.filter((match) => match.status === "Pendiente").length} pendientes
        </span>
      </div>

      <div className="grid gap-4">
        {matches.map((match) => {
          const message = template ? renderTemplate(template, { lead: match.lead, property: match.property, user }) : "";
          const whatsappHref = match.lead.phone
            ? `https://wa.me/${match.lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`
            : undefined;
          const mailHref = match.lead.email
            ? `mailto:${match.lead.email}?subject=${encodeURIComponent("Sobre tu busqueda de inmueble")}&body=${encodeURIComponent(message)}`
            : undefined;

          return (
            <article className="overflow-hidden rounded-lg border border-border bg-white shadow-panel" key={match.id}>
              <div className="grid lg:grid-cols-[270px_1fr]">
                <img alt={match.property.title} className="h-64 w-full object-cover lg:h-full" src={match.property.imageUrl} />
                <div className="grid gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{match.property.title}</h3>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          {match.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{match.property.location}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-semibold text-primary">{formatPercent(match.similarity.confidence)}</p>
                      <p className="text-xs text-muted-foreground">seguridad general</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Inmueble detectado</p>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <dt className="text-muted-foreground">Precio</dt>
                        <dd className="text-right font-medium">{formatCurrency(match.property.price)}</dd>
                        <dt className="text-muted-foreground">Area</dt>
                        <dd className="text-right font-medium">{match.property.areaM2} m2</dd>
                        <dt className="text-muted-foreground">Habitaciones</dt>
                        <dd className="text-right font-medium">{match.property.rooms}</dd>
                        <dt className="text-muted-foreground">Fuente</dt>
                        <dd className="text-right font-medium">{match.property.source}</dd>
                      </dl>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Lead interesado</p>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <dt className="text-muted-foreground">Nombre</dt>
                        <dd className="text-right font-medium">{match.lead.name}</dd>
                        <dt className="text-muted-foreground">Presupuesto</dt>
                        <dd className="text-right font-medium">{formatCurrency(match.lead.budget)}</dd>
                        <dt className="text-muted-foreground">Busca</dt>
                        <dd className="text-right font-medium">{match.lead.lookingFor}</dd>
                      </dl>
                    </div>
                  </div>

                  <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
                    <thead className="bg-muted text-left">
                      <tr>
                        <th className="px-3 py-2">Factor</th>
                        <th className="px-3 py-2">Peso</th>
                        <th className="px-3 py-2">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weights.map((item) => (
                        <tr className="border-t border-border" key={item.key}>
                          <td className="px-3 py-2">{item.label}</td>
                          <td className="px-3 py-2">{item.weight}</td>
                          <td className="px-3 py-2 font-medium">{formatPercent(match.similarity[item.key])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grid gap-3 rounded-lg bg-muted p-3 text-sm md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="font-medium">Datos de contacto crudos</p>
                      <p className="mt-1 text-muted-foreground">
                        {match.lead.phone || "Sin telefono"} · {match.lead.email || "Sin email"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(`${match.lead.name} ${match.lead.phone || ""} ${match.lead.email || ""}`)}
                      >
                        <Copy className="h-4 w-4" />
                        Copiar
                      </Button>
                      {match.property.url ? (
                        <Button variant="secondary" size="sm" onClick={() => window.open(match.property.url, "_blank")}>
                          <ExternalLink className="h-4 w-4" />
                          Publicacion
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-between gap-2">
                    <div className="flex gap-2">
                      <Button variant="secondary" disabled={!whatsappHref} onClick={() => whatsappHref && window.open(whatsappHref, "_blank")}>
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </Button>
                      <Button variant="secondary" disabled={!mailHref} onClick={() => mailHref && window.open(mailHref)}>
                        <Mail className="h-4 w-4" />
                        Email
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="danger" onClick={() => onDecision(match.id, "Rechazado")}>
                        <X className="h-4 w-4" />
                        Rechazar
                      </Button>
                      <Button onClick={() => onDecision(match.id, "Confirmado")}>
                        <Check className="h-4 w-4" />
                        Confirmar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
