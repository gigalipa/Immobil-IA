import type { Lead, MessageTemplate, Property, TemplateVariable, UserProfile } from "./types";
import { formatCurrency } from "./utils";

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  "Nombre_Lead",
  "Tipo_Inmueble",
  "Zona",
  "Precio",
  "Nombre_Agente",
];

export type TemplateContext = {
  lead: Lead;
  property: Property;
  user?: UserProfile;
};

export function renderTemplate(template: MessageTemplate, context: TemplateContext) {
  const values: Record<TemplateVariable, string> = {
    Nombre_Lead: context.lead.name,
    Tipo_Inmueble: context.property.title,
    Zona: context.property.location,
    Precio: formatCurrency(context.property.price),
    Nombre_Agente: context.user?.name || "tu asesor inmobiliario",
  };

  return TEMPLATE_VARIABLES.reduce((body, variable) => {
    return body.replaceAll(`[${variable}]`, values[variable]);
  }, template.body);
}

export function findUnknownVariables(body: string) {
  const matches = body.match(/\[[A-Za-z_]+\]/g) || [];
  return matches
    .map((token) => token.replace("[", "").replace("]", ""))
    .filter((token) => !TEMPLATE_VARIABLES.includes(token as TemplateVariable));
}
