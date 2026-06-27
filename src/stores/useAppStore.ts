import { create } from "zustand";
import { api } from "../lib/api";
import type {
  Lead,
  AgentRunSummary,
  ManualEntityKind,
  MatchSuggestion,
  MessageTemplate,
  Property,
  Radar,
  UserProfile,
} from "../lib/types";

type AppState = {
  user?: UserProfile;
  radars: Radar[];
  properties: Property[];
  leads: Lead[];
  matches: MatchSuggestion[];
  templates: MessageTemplate[];
  lastRun?: AgentRunSummary;
  selectedRadarId?: string;
  activeTemplateId?: string;
  isLoading: boolean;
  runningRadarId?: string;
  error?: string;
  runRadarError?: string;
  bootstrap: () => Promise<void>;
  completeOnboarding: (user: UserProfile) => Promise<void>;
  saveUserProfile: (user: UserProfile) => Promise<void>;
  logout: () => void;
  saveRadar: (radar: Radar) => Promise<void>;
  createManualEntity: (kind: ManualEntityKind, data: Property | Lead) => Promise<void>;
  updateMatchStatus: (id: string, status: MatchSuggestion["status"]) => Promise<void>;
  recordFeedback: (
    kind: string,
    entityId: string,
    decision: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
  saveTemplate: (template: MessageTemplate) => Promise<void>;
  runRadar: (radarId: string) => Promise<void>;
  selectRadar: (radarId: string) => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  radars: [],
  properties: [],
  leads: [],
  matches: [],
  templates: [],
  isLoading: true,
  runningRadarId: undefined,
  async bootstrap() {
    try {
      set({ isLoading: true, error: undefined });
      const data = await api.bootstrap();
      set({
        ...data,
        selectedRadarId: data.radars[0]?.id,
        activeTemplateId: data.templates[0]?.id,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : "Error desconocido" });
    }
  },
  async completeOnboarding(user) {
    const saved = await api.saveUser(user);
    set({ user: saved });
  },
  async saveUserProfile(user) {
    const saved = await api.saveUser(user);
    set({ user: saved });
  },
  logout() {
    localStorage.setItem("immobil-ia-session-active", "false");
    set({ user: undefined });
  },
  async saveRadar(radar) {
    const saved = await api.saveRadar(radar);
    const radars = get().radars;
    const exists = radars.some((item) => item.id === saved.id);
    set({
      radars: exists ? radars.map((item) => (item.id === saved.id ? saved : item)) : [...radars, saved],
      selectedRadarId: saved.id,
    });
  },
  async createManualEntity(kind, data) {
    const saved = await api.createManualEntity(kind, data);
    if (kind === "property") {
      set({ properties: [saved as Property, ...get().properties] });
    } else {
      set({ leads: [saved as Lead, ...get().leads] });
    }
  },
  async updateMatchStatus(id, status) {
    await api.updateMatchStatus(id, status);
    set({
      matches: get().matches.map((match) => (match.id === id ? { ...match, status } : match)),
    });
  },
  async recordFeedback(kind, entityId, decision, payload) {
    await api.recordFeedback(kind, entityId, decision, payload);
  },
  async saveTemplate(template) {
    const saved = await api.saveTemplate(template);
    const templates = get().templates;
    const exists = templates.some((item) => item.id === saved.id);
    set({
      templates: exists
        ? templates.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...templates],
      activeTemplateId: saved.id,
    });
  },
  async runRadar(radarId) {
    try {
      set({ runningRadarId: radarId, runRadarError: undefined });
      const data = await api.runRadar(radarId);
      set({
        ...data,
        selectedRadarId: radarId,
        activeTemplateId: data.templates[0]?.id || get().activeTemplateId,
        runningRadarId: undefined,
      });
    } catch (error) {
      set({
        runningRadarId: undefined,
        runRadarError: errorMessage(error),
      });
    }
  },
  selectRadar(radarId) {
    set({ selectedRadarId: radarId });
  },
}));

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "No se pudo ejecutar el radar";
}
