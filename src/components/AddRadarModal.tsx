import { useMemo, useState } from "react";
import { CalendarClock, Play, Save } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";
import { Modal } from "./ui/Modal";
import { ensureFrequencyForPlan, frequencyOptionsForPlan, normalizeKeywordInput, parseKeywordInput } from "../lib/radarRules";
import type { Radar, RadarFrequency, SubscriptionPlan } from "../lib/types";

type AddRadarModalProps = {
  plan: SubscriptionPlan;
  onClose: () => void;
  onSave: (radar: Radar) => Promise<void>;
  onSaveAndRun: (radar: Radar) => Promise<void>;
};

const zonesByCountry: Record<string, string[]> = {
  Colombia: ["Bogota - Chapinero", "Bogota - Usaquen", "Antioquia - Envigado", "Cundinamarca - Chia"],
  Francia: ["75001 Paris", "75015 Paris", "69002 Lyon", "13008 Marseille"],
  Mexico: ["CDMX - Roma Norte", "CDMX - Polanco", "Jalisco - Zapopan", "Nuevo Leon - San Pedro"],
};

export function AddRadarModal({ plan, onClose, onSave, onSaveAndRun }: AddRadarModalProps) {
  const [draft, setDraft] = useState<Radar>({
    id: crypto.randomUUID(),
    name: "",
    keywords: [],
    country: "Colombia",
    zone: "Bogota - Chapinero",
    frequency: ensureFrequencyForPlan(undefined, plan),
    isActive: true,
  });
  const [keywordText, setKeywordText] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const zones = useMemo(() => zonesByCountry[draft.country] || zonesByCountry.Colombia, [draft.country]);
  const frequencies = useMemo(() => frequencyOptionsForPlan(plan), [plan]);
  const canSave = draft.name.trim().length > 0 && draft.keywords.length > 0;
  const canSchedule = canSave && scheduledDate && scheduledTime;

  const saveAndRun = async () => {
    setIsSaving(true);
    await onSaveAndRun({ ...draft, frequency: ensureFrequencyForPlan(draft.frequency, plan) });
    setIsSaving(false);
    onClose();
  };

  const saveAndSchedule = async () => {
    setIsSaving(true);
    await onSave({
      ...draft,
      frequency: ensureFrequencyForPlan(draft.frequency, plan),
      scheduledStartAt: new Date(`${scheduledDate}T${scheduledTime}`).toISOString(),
    });
    setIsSaving(false);
    onClose();
  };

  return (
    <Modal title="Agregar Agente WS" onClose={onClose}>
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre del agente">
            <Input
              placeholder="Ej. Poblado arriendo"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Palabras clave" hint="Separadas por coma">
            <Input
              placeholder="apto, arriendo, poblado"
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
          <Field label="Frecuencia automatica">
            <Select
              value={draft.frequency}
              onChange={(event) => setDraft({ ...draft, frequency: event.target.value as RadarFrequency })}
            >
              {frequencies.map((frequency) => (
                <option key={frequency}>{frequency}</option>
              ))}
            </Select>
            {plan !== "Premium" ? (
              <span className="text-xs text-muted-foreground">La frecuencia diaria esta disponible en Premium.</span>
            ) : null}
          </Field>
          <label className="mt-6 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
            />
            Agente activo
          </label>
        </div>

        <section className="rounded-lg border border-border bg-muted p-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Programacion inicial</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Define cuando se ejecutara por primera vez y desde cuando comenzaran sus ejecuciones automaticas.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Dia de primera ejecucion">
              <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
            </Field>
            <Field label="Hora">
              <Input type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} />
            </Field>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={!canSave || isSaving} variant="secondary" onClick={saveAndRun}>
            <Play className="h-4 w-4" />
            Guardar y ejecutar
          </Button>
          <Button disabled={!canSchedule || isSaving} onClick={saveAndSchedule}>
            <Save className="h-4 w-4" />
            Guardar y programar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
