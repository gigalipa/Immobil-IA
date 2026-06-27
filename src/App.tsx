import { useEffect, useMemo, useState } from "react";
import { Onboarding } from "./components/Onboarding";
import { Sidebar, type AppSection } from "./components/Sidebar";
import { RadarConfig } from "./components/RadarConfig";
import { TemplateEditor } from "./components/TemplateEditor";
import { ManualEntryModal } from "./components/ManualEntryModal";
import { MorningBriefing } from "./components/MorningBriefing";
import { TopBar } from "./components/TopBar";
import { LeadsView, PropertiesView } from "./components/EntityViews";
import { AddRadarModal } from "./components/AddRadarModal";
import { UserSettings } from "./components/UserSettings";
import { Modal } from "./components/ui/Modal";
import { Button } from "./components/ui/Button";
import { useAppStore } from "./stores/useAppStore";
import { loadBehaviorSettings } from "./lib/clientBehavior";
import { buildPropertyGroups, relatePropertyGroups } from "./lib/propertyGroups";
import type { ManualEntityKind, PropertyRelation, Radar } from "./lib/types";

function App() {
  const {
    user,
    radars,
    properties,
    leads,
    matches,
    templates,
    lastRun,
    selectedRadarId,
    activeTemplateId,
    isLoading,
    runningRadarId,
    error,
    runRadarError,
    bootstrap,
    completeOnboarding,
    saveUserProfile,
    logout,
    saveRadar,
    createManualEntity,
    updateMatchStatus,
    recordFeedback,
    saveTemplate,
    runRadar,
    selectRadar,
  } = useAppStore();
  const [manualKind, setManualKind] = useState<ManualEntityKind | undefined>();
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [focusedPropertyId, setFocusedPropertyId] = useState<string | undefined>();
  const [focusedLeadId, setFocusedLeadId] = useState<string | undefined>();
  const [isAddRadarOpen, setIsAddRadarOpen] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | undefined>();
  const [manualRelations, setManualRelations] = useState<PropertyRelation[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("immobil-ia-manual-relations") || "[]") as PropertyRelation[];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function registerCloseBehavior() {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        if (!loadBehaviorSettings().keepActiveOnClose) return;
        event.preventDefault();
        await appWindow.minimize();
      });
    }

    registerCloseBehavior();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("immobil-ia-manual-relations", JSON.stringify(manualRelations));
  }, [manualRelations]);

  const selectedRadar = useMemo(
    () => radars.find((radar) => radar.id === selectedRadarId),
    [radars, selectedRadarId]
  );
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) || templates[0],
    [templates, activeTemplateId]
  );
  const propertyGroups = useMemo(
    () => buildPropertyGroups(properties, matches, manualRelations),
    [properties, matches, manualRelations]
  );
  const radarActivity = useMemo(
    () => (properties.length ? [{ day: "Actual", publications: properties.length }] : []),
    [properties.length]
  );
  const demandDistribution = useMemo(() => {
    if (!leads.length) return [];
    const buckets = leads.reduce<Record<string, number>>((accumulator, lead) => {
      const key = lead.role || "Sin clasificar";
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    return Object.entries(buckets).map(([name, count]) => ({
      name,
      value: Math.round((count / leads.length) * 100),
    }));
  }, [leads]);

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="rounded-lg border border-border bg-white px-5 py-4 shadow-panel">
          Cargando Immobil-IA...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-lg border border-danger bg-white p-5 shadow-panel">
          <h1 className="text-lg font-semibold">No se pudo iniciar</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <Onboarding onComplete={completeOnboarding} />;
  }

  const openProperty = (id: string) => {
    setFocusedPropertyId(id);
    setFocusedLeadId(undefined);
    setActiveSection("properties");
  };

  const openLead = (id: string) => {
    setFocusedLeadId(id);
    setFocusedPropertyId(undefined);
    setActiveSection("leads");
  };

  const relateGroups = (firstGroupId: string, secondGroupId: string) => {
    const firstGroup = propertyGroups.find((group) => group.id === firstGroupId);
    const secondGroup = propertyGroups.find((group) => group.id === secondGroupId);
    if (!firstGroup || !secondGroup) return;
    const relation = relatePropertyGroups(firstGroup, secondGroup);
    setManualRelations((current) => [...current, relation]);
    recordFeedback(
      "manual_property_relation",
      relation.propertyIds.join("::"),
      "Confirmado",
      {
        relation,
        firstGroup: {
          id: firstGroup.id,
          title: firstGroup.title,
          representativeId: firstGroup.representative.id,
          publicationIds: firstGroup.publications.map((publication) => publication.id),
        },
        secondGroup: {
          id: secondGroup.id,
          title: secondGroup.title,
          representativeId: secondGroup.representative.id,
          publicationIds: secondGroup.publications.map((publication) => publication.id),
        },
        createdLocallyAt: new Date().toISOString(),
      }
    ).catch((error) => {
      console.error("No se pudo registrar feedback manual", error);
    });
  };

  const requestAddRadar = () => {
    const status = user.subscriptionStatus || "Activa";
    if (status !== "Activa") {
      setUpgradeMessage("Tu suscripcion no esta activa. Reactivala para crear nuevos Agentes WS.");
      return;
    }
    if (user.plan === "Basica") {
      setUpgradeMessage("Los Agentes WS multiples estan disponibles en los planes Pro y Premium. Mejora tu suscripcion para crear otro radar.");
      return;
    }
    setIsAddRadarOpen(true);
  };

  const saveNewRadar = async (radar: Radar) => {
    await saveRadar(radar);
  };

  const saveAndRunNewRadar = async (radar: Radar) => {
    await saveRadar(radar);
    await runRadar(radar.id);
  };

  return (
    <div className="h-screen overflow-hidden bg-background md:grid md:grid-cols-[18rem_1fr]">
      <Sidebar
        user={user}
        activeSection={activeSection}
        onNavigate={(section) => {
          setActiveSection(section);
          setFocusedLeadId(undefined);
          setFocusedPropertyId(undefined);
        }}
        onAddProperty={() => setManualKind("property")}
        onAddLead={() => setManualKind("lead")}
      />

      <div className="grid h-screen grid-rows-[auto_1fr] overflow-hidden">
        <TopBar
          user={user}
          radars={radars}
          selectedRadarId={selectedRadarId}
          onSelectRadar={selectRadar}
          onAddRadar={requestAddRadar}
          propertyGroupCount={propertyGroups.length}
          leadCount={leads.length}
          matches={matches}
          lastRun={lastRun}
        />

        <main className="overflow-auto p-4 md:p-5">
          {activeSection === "dashboard" ? (
            <MorningBriefing
              matches={matches}
              template={activeTemplate}
              user={user}
              onDecision={updateMatchStatus}
              onOpenLead={openLead}
              onOpenProperty={openProperty}
              radarActivity={radarActivity}
              demandDistribution={demandDistribution}
            />
          ) : null}

          {activeSection === "properties" ? (
            <PropertiesView
              propertyGroups={propertyGroups}
              focusedPropertyId={focusedPropertyId}
              onRelateGroups={relateGroups}
            />
          ) : null}

          {activeSection === "leads" ? (
            <LeadsView
              leads={leads}
              focusedLeadId={focusedLeadId}
              propertyGroups={propertyGroups}
              onOpenProperty={openProperty}
            />
          ) : null}

          {activeSection === "templates" ? (
            <TemplateEditor
              template={activeTemplate}
              lead={matches[0]?.lead}
              property={matches[0]?.property}
              user={user}
              onSave={saveTemplate}
            />
          ) : null}

          {activeSection === "settings" ? (
            <RadarConfig
              radar={selectedRadar}
              plan={user.plan}
              isRunning={selectedRadar ? runningRadarId === selectedRadar.id : false}
              runError={runRadarError}
              onSave={saveRadar}
              onRun={runRadar}
            />
          ) : null}

          {activeSection === "userSettings" ? (
            <UserSettings user={user} onSave={saveUserProfile} onLogout={logout} />
          ) : null}
        </main>
      </div>

      {manualKind ? (
        <ManualEntryModal
          kind={manualKind}
          onClose={() => setManualKind(undefined)}
          onSubmit={createManualEntity}
        />
      ) : null}

      {isAddRadarOpen ? (
        <AddRadarModal
          onClose={() => setIsAddRadarOpen(false)}
          plan={user.plan}
          onSave={saveNewRadar}
          onSaveAndRun={saveAndRunNewRadar}
        />
      ) : null}

      {upgradeMessage ? (
        <Modal title="Mejora tu suscripcion" onClose={() => setUpgradeMessage(undefined)}>
          <div className="grid gap-4">
            <p className="text-sm leading-6 text-muted-foreground">{upgradeMessage}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setUpgradeMessage(undefined)}>
                Ahora no
              </Button>
              <Button
                onClick={() => {
                  setUpgradeMessage(undefined);
                  setActiveSection("userSettings");
                }}
              >
                Ver planes
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default App;
