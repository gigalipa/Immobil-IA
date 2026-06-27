import { useState } from "react";
import { Building2, CheckCircle2, CreditCard, MailCheck } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";
import type { SubscriptionPlan, UserProfile } from "../lib/types";

type OnboardingProps = {
  onComplete: (user: UserProfile) => Promise<void>;
};

const plans: Array<{ id: SubscriptionPlan; agents: string; price: string }> = [
  { id: "Basica", agents: "1 Agente WS", price: "$0 beta" },
  { id: "Pro", agents: "3 Agentes WS", price: "$0 beta" },
  { id: "Premium", agents: "10 Agentes WS", price: "$0 beta" },
];

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [plan, setPlan] = useState<SubscriptionPlan>("Pro");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    phone: "",
    city: "Bogota",
    country: "Colombia",
  });

  const submit = async () => {
    await onComplete({
      id: crypto.randomUUID(),
      ...form,
      plan,
      subscriptionStatus: "Activa",
      acceptedTerms,
    });
  };

  return (
    <main className="grid min-h-screen place-items-center p-5">
      <section className="w-full max-w-4xl rounded-lg border border-border bg-white shadow-panel">
        <div className="grid gap-6 p-6 md:grid-cols-[0.9fr_1.1fr]">
          <aside className="rounded-lg bg-emerald-900 p-6 text-white">
            <Building2 className="mb-8 h-10 w-10" />
            <h1 className="text-3xl font-semibold">Immobil-IA</h1>
            <p className="mt-3 text-sm leading-6 text-emerald-50">
              Prospeccion inmobiliaria local, validacion humana y contacto directo con leads desde tu equipo.
            </p>
          </aside>

          <div className="grid gap-6">
            <div className="flex gap-2 text-sm">
              {[1, 2, 3].map((item) => (
                <span
                  className={`h-2 flex-1 rounded-full ${item <= step ? "bg-primary" : "bg-muted"}`}
                  key={item}
                />
              ))}
            </div>

            {step === 1 ? (
              <div className="grid gap-4">
                <MailCheck className="h-9 w-9 text-primary" />
                <div>
                  <h2 className="text-xl font-semibold">Verifica tu correo</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Usaremos este correo para identificar tu cuenta local beta.
                  </p>
                </div>
                <Field label="Correo">
                  <Input
                    type="email"
                    placeholder="asesor@empresa.com"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </Field>
                <Button disabled={!form.email.includes("@")} onClick={() => setStep(2)}>
                  Continuar
                </Button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-4">
                <h2 className="text-xl font-semibold">Datos de registro</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nombre">
                    <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                  </Field>
                  <Field label="Telefono">
                    <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                  </Field>
                  <Field label="Ciudad">
                    <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                  </Field>
                  <Field label="Pais">
                    <Select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>
                      <option>Colombia</option>
                      <option>Francia</option>
                      <option>Mexico</option>
                    </Select>
                  </Field>
                </div>
                <Button disabled={!form.name || !form.phone} onClick={() => setStep(3)}>
                  Continuar
                </Button>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-4">
                <CreditCard className="h-9 w-9 text-primary" />
                <h2 className="text-xl font-semibold">Suscripcion beta</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {plans.map((item) => (
                    <button
                      className={`rounded-lg border p-4 text-left transition ${
                        plan === item.id ? "border-primary bg-emerald-50" : "border-border bg-white"
                      }`}
                      key={item.id}
                      onClick={() => setPlan(item.id)}
                    >
                      <span className="font-semibold">{item.id}</span>
                      <span className="mt-2 block text-sm text-muted-foreground">{item.agents}</span>
                      <span className="mt-3 block text-sm font-medium">{item.price}</span>
                    </button>
                  ))}
                </div>
                <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                  />
                  <span>
                    Acepto los Terminos de Uso y asumo la responsabilidad del tratamiento de datos extraidos por mis
                    radares.
                  </span>
                </label>
                <Button disabled={!acceptedTerms} onClick={submit}>
                  <CheckCircle2 className="h-4 w-4" />
                  Entrar al dashboard
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
