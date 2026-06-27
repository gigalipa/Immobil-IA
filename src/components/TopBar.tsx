import { CalendarDays, ChevronDown, ChevronUp, Clock3, Database, Link2, PlusCircle, Radar, UserRound, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentRunSummary, MatchSuggestion, Radar as RadarType, UserProfile } from "../lib/types";

type TopBarProps = {
  user: UserProfile;
  radars: RadarType[];
  selectedRadarId?: string;
  onSelectRadar: (id: string) => void;
  onAddRadar: () => void;
  propertyGroupCount: number;
  leadCount: number;
  matches: MatchSuggestion[];
  lastRun?: AgentRunSummary;
};

export function TopBar({
  user,
  radars,
  selectedRadarId,
  onSelectRadar,
  onAddRadar,
  propertyGroupCount,
  leadCount,
  matches,
  lastRun,
}: TopBarProps) {
  const metricsRef = useRef<HTMLDivElement>(null);
  const [isMetricsExpanded, setIsMetricsExpanded] = useState(false);
  const [hasHiddenMetrics, setHasHiddenMetrics] = useState(false);
  const [collapsedMetricsHeight, setCollapsedMetricsHeight] = useState<number>();
  const [expandedMetricsHeight, setExpandedMetricsHeight] = useState<number>();
  const selectedRadar = radars.find((radar) => radar.id === selectedRadarId);
  const pendingMatches = matches.filter((match) => match.status === "Pendiente").length;
  const canCreateRadar = user.subscriptionStatus !== "Vencida" && user.subscriptionStatus !== "Desactivada" && user.plan !== "Basica";
  const lastRunTime = formatLastRun(lastRun?.finishedAt || selectedRadar?.lastRunAt);

  useEffect(() => {
    const element = metricsRef.current;
    if (!element) return;

    const updateOverflow = () => {
      const items = Array.from(element.children) as HTMLElement[];
      const firstTop = items[0]?.offsetTop ?? 0;
      const hasWrappedItems = items.some((item) => item.offsetTop > firstTop + 2);
      const firstRowItems = items.filter((item) => Math.abs(item.offsetTop - firstTop) <= 2);
      const firstRowHeight = Math.max(...firstRowItems.map((item) => item.offsetHeight), 0);
      setHasHiddenMetrics(hasWrappedItems);
      setCollapsedMetricsHeight(firstRowHeight || undefined);
      setExpandedMetricsHeight(element.scrollHeight);
      if (!hasWrappedItems) {
        setIsMetricsExpanded(false);
      }
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    window.addEventListener("resize", updateOverflow);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [radars.length, propertyGroupCount, leadCount, pendingMatches, lastRun?.id, selectedRadarId]);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-5 py-3 backdrop-blur">
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <div className="grid content-start gap-2 xl:sticky xl:top-3">
          <label className="grid gap-2 text-sm font-semibold">
            Agente WS activo
            <select
              className="h-10 rounded-md border border-border bg-white px-3 text-sm shadow-sm"
              value={selectedRadarId}
              onChange={(event) => onSelectRadar(event.target.value)}
            >
              {radars.map((radar) => (
                <option key={radar.id} value={radar.id}>
                  {radar.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
              canCreateRadar
                ? "border-primary bg-primary text-primary-foreground hover:brightness-110"
                : "border-border bg-white text-muted-foreground hover:bg-muted"
            }`}
            onClick={onAddRadar}
          >
            <PlusCircle className="h-4 w-4" />
            Agregar Agente WS
          </button>
        </div>

        <div className="relative min-w-0">
          <div
            ref={metricsRef}
            className="flex flex-wrap gap-3 overflow-hidden pr-12 transition-[max-height] duration-200"
            style={{
              maxHeight: isMetricsExpanded
                ? expandedMetricsHeight
                  ? `${expandedMetricsHeight}px`
                  : "28rem"
                : collapsedMetricsHeight
                  ? `${collapsedMetricsHeight}px`
                  : "6rem",
            }}
          >
            <TopMetric icon={<Wifi className="h-4 w-4" />} label="Radares" value={radars.length} />
            <TopMetric icon={<Database className="h-4 w-4" />} label="Inmuebles" value={propertyGroupCount} />
            <TopMetric icon={<UserRound className="h-4 w-4" />} label="Leads" value={leadCount} />
            <TopMetric icon={<Link2 className="h-4 w-4" />} label="Pendientes" value={pendingMatches} />

            <div className="min-h-24 w-max min-w-52 shrink-0 rounded-lg border border-border bg-white p-3 text-sm shadow-sm">
              <p className="whitespace-nowrap font-medium text-muted-foreground">Ultima ejecucion</p>
              <div className="mt-1 grid gap-1">
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <Radar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{selectedRadar?.name || "Sin radar"}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{lastRunTime.date}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{lastRunTime.time}</span>
                </span>
              </div>
            </div>

            <div className="min-h-24 w-max min-w-56 shrink-0 rounded-lg border border-border bg-white p-3 text-sm shadow-sm">
              <p className="whitespace-nowrap font-medium text-muted-foreground">Resultados recientes</p>
              <dl className="mt-1 grid gap-1">
                <ResultRow icon={<Database className="h-3.5 w-3.5" />} value={lastRun?.publicationsCount || 0} label="Publicaciones" />
                <ResultRow icon={<UserRound className="h-3.5 w-3.5" />} value={lastRun?.leadsCount || 0} label="Leads" />
                <ResultRow icon={<Link2 className="h-3.5 w-3.5" />} value={lastRun?.matchesCount || 0} label="Matches" />
              </dl>
            </div>
          </div>

          {hasHiddenMetrics ? (
            <button
              aria-label={isMetricsExpanded ? "Ocultar KPIs" : "Mostrar todos los KPIs"}
              className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-white text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              onClick={() => setIsMetricsExpanded((current) => !current)}
              type="button"
            >
              {isMetricsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function formatLastRun(value?: string) {
  if (!value) {
    return { date: "Sin ejecuciones", time: "--" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: "Fecha no disponible", time: "--" };
  }

  return {
    date: new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("es-CO", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  };
}

function TopMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="min-h-24 min-w-24 shrink-0 rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-3xl font-light leading-none">{value}</p>
    </div>
  );
}

function ResultRow({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="w-5 shrink-0 font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </div>
  );
}
