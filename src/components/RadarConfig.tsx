import { useEffect, useMemo, useState } from "react";
import { Play, Save } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";
import { ensureFrequencyForPlan, frequencyOptionsForPlan, normalizeKeywordInput, parseKeywordInput } from "../lib/radarRules";
import type { Radar, RadarFrequency, SubscriptionPlan } from "../lib/types";

type RadarConfigProps = {
  radar?: Radar;
  plan: SubscriptionPlan;
  isRunning?: boolean;
  runError?: string;
  onSave: (radar: Radar) => Promise<void>;
  onRun: (radarId: string) => Promise<void>;
};

const zonesByCountry: Record<string, string[]> = {
  Colombia: ["Bogota - Chapinero", "Bogota - Usaquen", "Antioquia - Envigado", "Cundinamarca - Chia"],
  Francia: ["75001 Paris", "75015 Paris", "69002 Lyon", "13008 Marseille"],
  Mexico: ["CDMX - Roma Norte", "CDMX - Polanco", "Jalisco - Zapopan", "Nuevo Leon - San Pedro"],
};

function emptyRadar(plan: SubscriptionPlan): Radar {
  return {
    id: crypto.randomUUID(),
    name: "Nuevo radar",
    keywords: [],
    country: "Colombia",
    zone: "Bogota - Chapinero",
    frequency: ensureFrequencyForPlan(undefined, plan),
    isActive: true,
  };
}

export function RadarConfig({ radar, plan, isRunning = false, runError, onSave, onRun }: RadarConfigProps) {
  const [draft, setDraft] = useState<Radar>(
    radar ? { ...radar, frequency: ensureFrequencyForPlan(radar.frequency, plan) } : emptyRadar(plan)
  );
  const [keywordText, setKeywordText] = useState(draft.keywords.join(", "));

  const zones = useMemo(() => zonesByCountry[draft.country] || zonesByCountry.Colombia, [draft.country]);
  const frequencies = useMemo(() => frequencyOptionsForPlan(plan), [plan]);

  useEffect(() => {
    const nextDraft = radar ? { ...radar, frequency: ensureFrequencyForPlan(radar.frequency, plan) } : emptyRadar(plan);
    setDraft(nextDraft);
    setKeywordText(nextDraft.keywords.join(", "));
  }, [plan, radar]);

  return (
    <section className="grid gap-5" id="configuracion">
      <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Configuracion del Agente WS</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Parametros del Agente WS seleccionado. Estos datos viven localmente en este equipo.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!radar?.id || isRunning} onClick={() => radar?.id && onRun(radar.id)}>
              <Play className="h-4 w-4" />
              {isRunning ? "Ejecutando..." : "Ejecutar"}
            </Button>
            <Button onClick={() => onSave(draft)}>
              <Save className="h-4 w-4" />
              Guardar
            </Button>
          </div>
        </div>
        {runError ? (
          <div className="mt-4 rounded-md border border-danger bg-red-50 px-3 py-2 text-sm text-danger">
            {runError}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Nombre del agente">
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="Palabras clave" hint="Separadas por coma: apartamento, venta, dueno directo">
            <Input
              value={keywordText}
              onChange={(event) => {
                const value = normalizeKeywordInput(event.target.value);
                setKeywordText(value);
                setDraft({
                  ...draft,
                  keywords: parseKeywordInput(value),
                });
              }}
            />
          </Field>
          <Field label="Pais">
            <Select
              value={draft.country}
              onChange={(event) =>
                setDraft({ ...draft, country: event.target.value, zone: zonesByCountry[event.target.value][0] })
              }
            >
              {Object.keys(zonesByCountry).map((country) => (
                <option key={country}>{country}</option>
              ))}
            </Select>
          </Field>
          <Field label="Zona geografica">
            <Select value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })}>
              {zones.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </Select>
          </Field>
          <Field label="Frecuencia">
            <Select
              value={draft.frequency}
              onChange={(event) => setDraft({ ...draft, frequency: event.target.value as RadarFrequency })}
            >
              {frequencies.map((frequency) => (
                <option key={frequency}>{frequency}</option>
              ))}
            </Select>
            {plan !== "Premium" ? (
              <span className="text-xs text-muted-foreground">Basica y Pro permiten frecuencia semanal o quincenal.</span>
            ) : null}
          </Field>
          <label className="mt-6 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
            />
            Radar activo
          </label>
        </div>
      </section>
    </section>
  );
}
