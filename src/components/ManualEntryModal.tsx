import { useState } from "react";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Field";
import { Modal } from "./ui/Modal";
import type { Lead, ManualEntityKind, Property } from "../lib/types";

type ManualEntryModalProps = {
  kind: ManualEntityKind;
  onClose: () => void;
  onSubmit: (kind: ManualEntityKind, data: Property | Lead) => Promise<void>;
};

export function ManualEntryModal({ kind, onClose, onSubmit }: ManualEntryModalProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const title = kind === "property" ? "Agregar inmueble" : "Agregar lead";

  const submit = async () => {
    if (kind === "property") {
      await onSubmit("property", {
        id: crypto.randomUUID(),
        title: form.title || "Inmueble sin titulo",
        source: "Manual",
        location: form.location || "Sin zona",
        price: Number(form.price || 0),
        areaM2: Number(form.areaM2 || 0),
        rooms: Number(form.rooms || 0),
        lat: Number(form.lat || 0),
        lng: Number(form.lng || 0),
        imageUrl:
          form.imageUrl ||
          "https://images.unsplash.com/photo-1560448204-603b3fc33ddc?auto=format&fit=crop&w=900&q=80",
        ownerName: form.ownerName,
        ownerPhone: form.ownerPhone,
        ownerEmail: form.ownerEmail,
        url: form.url,
      });
    } else {
      await onSubmit("lead", {
        id: crypto.randomUUID(),
        name: form.name || "Lead sin nombre",
        phone: form.phone,
        email: form.email,
        lookingFor: form.lookingFor || "Busqueda inmobiliaria",
        budget: Number(form.budget || 0),
        location: form.location || "Sin zona",
        sourceUrl: form.sourceUrl,
      });
    }
    onClose();
  };

  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-4">
        {kind === "property" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Titulo">
              <Input value={form.title || ""} onChange={(event) => update("title", event.target.value)} />
            </Field>
            <Field label="Zona">
              <Input value={form.location || ""} onChange={(event) => update("location", event.target.value)} />
            </Field>
            <Field label="Precio">
              <Input type="number" value={form.price || ""} onChange={(event) => update("price", event.target.value)} />
            </Field>
            <Field label="Area m2">
              <Input type="number" value={form.areaM2 || ""} onChange={(event) => update("areaM2", event.target.value)} />
            </Field>
            <Field label="Habitaciones">
              <Input type="number" value={form.rooms || ""} onChange={(event) => update("rooms", event.target.value)} />
            </Field>
            <Field label="Nombre propietario">
              <Input value={form.ownerName || ""} onChange={(event) => update("ownerName", event.target.value)} />
            </Field>
            <Field label="Telefono propietario">
              <Input value={form.ownerPhone || ""} onChange={(event) => update("ownerPhone", event.target.value)} />
            </Field>
            <Field label="Email propietario">
              <Input value={form.ownerEmail || ""} onChange={(event) => update("ownerEmail", event.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={form.name || ""} onChange={(event) => update("name", event.target.value)} />
            </Field>
            <Field label="Telefono">
              <Input value={form.phone || ""} onChange={(event) => update("phone", event.target.value)} />
            </Field>
            <Field label="Email">
              <Input value={form.email || ""} onChange={(event) => update("email", event.target.value)} />
            </Field>
            <Field label="Zona">
              <Input value={form.location || ""} onChange={(event) => update("location", event.target.value)} />
            </Field>
            <Field label="Presupuesto">
              <Input type="number" value={form.budget || ""} onChange={(event) => update("budget", event.target.value)} />
            </Field>
            <Field label="Busca">
              <Input value={form.lookingFor || ""} onChange={(event) => update("lookingFor", event.target.value)} />
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>Guardar</Button>
        </div>
      </div>
    </Modal>
  );
}
