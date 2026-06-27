import { invoke } from "@tauri-apps/api/core";
import {
  demoLeads,
  demoMatches,
  demoProperties,
  demoRadars,
  demoTemplates,
  demoUser,
} from "./demoData";
import type {
  Lead,
  AgentRunSummary,
  ManualEntityKind,
  MatchSuggestion,
  MessageTemplate,
  Property,
  Radar,
  UserProfile,
} from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
const dataMode = import.meta.env.VITE_IMMOBILIA_DATA_MODE || "demo";

type BootstrapData = {
  user?: UserProfile;
  radars: Radar[];
  properties: Property[];
  leads: Lead[];
  matches: MatchSuggestion[];
  templates: MessageTemplate[];
  lastRun?: AgentRunSummary;
};

const emptyBootstrap: BootstrapData = {
  user: undefined,
  radars: [],
  properties: [],
  leads: [],
  matches: [],
  templates: [],
  lastRun: undefined,
};

const demoBootstrap: BootstrapData = {
  user: demoUser,
  radars: demoRadars,
  properties: demoProperties,
  leads: demoLeads,
  matches: demoMatches,
  templates: demoTemplates,
  lastRun: undefined,
};

async function call<T>(command: string, payload?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, payload);
  }

  await new Promise((resolve) => window.setTimeout(resolve, 180));
  if (fallback === undefined) {
    throw new Error(`No hay fallback para ${command}`);
  }
  return fallback;
}

export const api = {
  bootstrap() {
    return call<BootstrapData>("bootstrap", undefined, dataMode === "demo" ? demoBootstrap : emptyBootstrap);
  },
  saveUser(user: UserProfile) {
    return call<UserProfile>("save_user", { user }, user);
  },
  saveRadar(radar: Radar) {
    return call<Radar>("save_radar", { radar }, radar);
  },
  createManualEntity(kind: ManualEntityKind, data: Property | Lead) {
    return call<Property | Lead>("create_manual_entity", { kind, data }, data);
  },
  updateMatchStatus(id: string, status: MatchSuggestion["status"]) {
    return call<MatchSuggestion["status"]>("update_match_status", { id, status }, status);
  },
  async recordFeedback(kind: string, entityId: string, decision: string, payload: Record<string, unknown>) {
    await call<null>("record_feedback", { kind, entityId, decision, payload }, null);
  },
  async openExternalUrl(url: string) {
    await call<null>("open_external_url", { url }, null);
  },
  saveTemplate(template: MessageTemplate) {
    return call<MessageTemplate>("save_template", { template }, template);
  },
  runRadar(radarId: string) {
    return call<BootstrapData>("run_radar", { radarId }, dataMode === "demo" ? demoBootstrap : emptyBootstrap);
  },
};
