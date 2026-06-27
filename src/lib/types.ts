export type SubscriptionPlan = "Basica" | "Pro" | "Premium";

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  phone: string;
  city: string;
  country: string;
  plan: SubscriptionPlan;
  subscriptionStatus?: "Activa" | "Vencida" | "Desactivada";
  acceptedTerms: boolean;
};

export type RadarFrequency = "Semanal" | "Quincenal" | "Diaria";

export type Radar = {
  id: string;
  name: string;
  keywords: string[];
  country: string;
  zone: string;
  frequency: RadarFrequency;
  isActive: boolean;
  lastRunAt?: string;
  scheduledStartAt?: string;
};

export type Property = {
  id: string;
  title: string;
  source: "Manual" | "Scraper" | "Portal" | "Red social";
  location: string;
  price: number;
  areaM2: number;
  rooms: number;
  lat: number;
  lng: number;
  imageUrl: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  url?: string;
  sourceUrl?: string;
  propertyGroupId?: string;
  publicationIds?: string[];
  publicationCount?: number;
};

export type PropertyRelation = {
  propertyIds: string[];
  certainty: number;
  source: "ml" | "human";
  status: "Pendiente" | "Confirmado";
};

export type PropertyGroup = {
  id: string;
  title: string;
  location: string;
  representative: Property;
  publications: Property[];
  certainty?: number;
  source: "Sin comparar" | "ML" | "Humano";
  status: "Pendiente HITL" | "Confirmado" | "Sin comparar";
};

export type Lead = {
  id: string;
  name: string;
  role?: "Propietario" | "Arrendador" | "Comprador" | "Arrendatario";
  phone?: string;
  email?: string;
  address?: string;
  lookingFor: string;
  budget: number;
  location: string;
  propertyId?: string;
  propertySummary?: string;
  sourceUrl?: string;
};

export type WeightedSimilarity = {
  gps: number;
  visual: number;
  features: number;
  confidence: number;
};

export type MatchSuggestion = {
  id: string;
  source?: "PostComparer" | "MatchMaker";
  property: Property;
  comparisonProperty?: Property;
  lead: Lead;
  similarity: WeightedSimilarity;
  status: "Pendiente" | "Confirmado" | "Rechazado";
};

export type RadarActivityPoint = {
  day: string;
  publications: number;
};

export type DemandDistributionPoint = {
  name: string;
  value: number;
};

export type TemplateVariable =
  | "Nombre_Lead"
  | "Tipo_Inmueble"
  | "Zona"
  | "Precio"
  | "Nombre_Agente";

export type MessageTemplate = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
};

export type AgentRunSummary = {
  id: string;
  radarId: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  publicationsCount: number;
  leadsCount: number;
  matchesCount: number;
};

export type ManualEntityKind = "property" | "lead";
