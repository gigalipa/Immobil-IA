import { useMemo, useState } from "react";
import { AlertCircle, Save } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Input, Textarea } from "./ui/Field";
import { findUnknownVariables, renderTemplate, TEMPLATE_VARIABLES } from "../lib/templateRenderer";
import type { Lead, MessageTemplate, Property, UserProfile } from "../lib/types";

type TemplateEditorProps = {
  template?: MessageTemplate;
  lead?: Lead;
  property?: Property;
  user?: UserProfile;
  onSave: (template: MessageTemplate) => Promise<void>;
};

export function TemplateEditor({ template, lead, property, user, onSave }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name || "Nueva plantilla");
  const [body, setBody] = useState(template?.body || "Hola [Nombre_Lead], soy [Nombre_Agente].");

  const unknownVariables = useMemo(() => findUnknownVariables(body), [body]);
  const preview =
    template && lead && property
      ? renderTemplate({ ...template, name, body }, { lead, property, user })
      : "Selecciona un match para previsualizar con datos reales.";

  const insertVariable = (variable: string) => {
    setBody((current) => `${current}${current.endsWith(" ") || current.length === 0 ? "" : " "}[${variable}]`);
  };

  return (
    <section className="rounded-lg border border-border bg-white p-5 shadow-panel" id="plantillas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Plantillas dinamicas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inserta variables desde botones para evitar errores de sintaxis.
          </p>
        </div>
        <Button
          disabled={unknownVariables.length > 0}
          onClick={() =>
            onSave({
              id: template?.id || crypto.randomUUID(),
              name,
              body,
              updatedAt: new Date().toISOString(),
            })
          }
        >
          <Save className="h-4 w-4" />
          Guardar
        </Button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="grid gap-4">
          <Field label="Nombre">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Mensaje">
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES.map((variable) => (
              <Button key={variable} variant="secondary" size="sm" onClick={() => insertVariable(variable)}>
                [{variable}]
              </Button>
            ))}
          </div>
          {unknownVariables.length > 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-warning bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="h-4 w-4" />
              Variables no permitidas: {unknownVariables.join(", ")}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-border bg-muted p-4">
          <p className="text-sm font-semibold">Vista previa renderizada</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{preview}</p>
        </div>
      </div>
    </section>
  );
}
