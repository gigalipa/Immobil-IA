import { useMemo, useState } from "react";
import { BadgeCheck, CreditCard, LogOut, MonitorCog, Save, UserRound } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";
import { Modal } from "./ui/Modal";
import {
  applyStartupPreference,
  loadBehaviorSettings,
  saveBehaviorSettings,
  type ClientBehaviorSettings,
} from "../lib/clientBehavior";
import type { UserProfile } from "../lib/types";

type UserSettingsProps = {
  user: UserProfile;
  onSave: (user: UserProfile) => Promise<void>;
  onLogout: () => void;
};

const hideLogoutWarningKey = "immobil-ia-hide-logout-warning";

export function UserSettings({ user, onSave, onLogout }: UserSettingsProps) {
  const [profile, setProfile] = useState(user);
  const [paymentMethod, setPaymentMethod] = useState("Visa terminada en 4242");
  const [behavior, setBehavior] = useState<ClientBehaviorSettings>(loadBehaviorSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);
  const [hideLogoutWarning, setHideLogoutWarning] = useState(
    localStorage.getItem(hideLogoutWarningKey) === "true"
  );

  const subscriptionStatus = profile.subscriptionStatus || "Activa";
  const statusTone = useMemo(() => {
    if (subscriptionStatus === "Activa") return "bg-emerald-50 text-emerald-900";
    if (subscriptionStatus === "Vencida") return "bg-amber-50 text-amber-900";
    return "bg-red-50 text-red-900";
  }, [subscriptionStatus]);

  const saveProfile = async () => {
    setIsSaving(true);
    setSaveError(undefined);
    try {
      await onSave(profile);
      saveBehaviorSettings(behavior);
      await applyStartupPreference(behavior.launchOnStartup);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudieron guardar las preferencias.");
    } finally {
      setIsSaving(false);
    }
  };

  const requestLogout = () => {
    if (localStorage.getItem(hideLogoutWarningKey) === "true") {
      onLogout();
      return;
    }
    setShowLogoutWarning(true);
  };

  const confirmLogout = () => {
    localStorage.setItem(hideLogoutWarningKey, hideLogoutWarning ? "true" : "false");
    onLogout();
  };

  return (
    <section className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Datos personales</h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Nombre">
              <Input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
            </Field>
            <Field label="Telefono">
              <Input
                value={profile.phone}
                onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
              />
            </Field>
            <Field label="Ciudad">
              <Input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} />
            </Field>
            <Field label="Pais">
              <Select
                value={profile.country}
                onChange={(event) => setProfile({ ...profile, country: event.target.value })}
              >
                <option>Colombia</option>
                <option>Francia</option>
                <option>Mexico</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" disabled={isSaving} onClick={saveProfile}>
              <Save className="h-4 w-4" />
              Guardar datos
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Suscripcion y pago</h2>
          </div>
          <div className="mt-5 grid gap-4">
            <div className={`rounded-md px-3 py-2 text-sm ${statusTone}`}>
              <p className="flex items-center gap-2 font-medium">
                <BadgeCheck className="h-4 w-4" />
                Plan {profile.plan} - {subscriptionStatus}
              </p>
              <p className="mt-1">
                La validacion del plan y pagos se sincroniza con el servidor administrativo.
              </p>
            </div>
            <Field label="Metodo de pago">
              <Input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary">Actualizar pago</Button>
            <Button>Cambiar plan</Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <MonitorCog className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Comportamiento del programa</h2>
        </div>
        <div className="mt-5 grid gap-3">
          <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={behavior.launchOnStartup}
              onChange={(event) => setBehavior({ ...behavior, launchOnStartup: event.target.checked })}
            />
            <span>
              <span className="block font-medium">Iniciar automaticamente al encender el PC</span>
              <span className="text-muted-foreground">
                Permite que los Agentes WS programados queden listos cuando Windows inicia.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={behavior.keepActiveOnClose}
              onChange={(event) => setBehavior({ ...behavior, keepActiveOnClose: event.target.checked })}
            />
            <span>
              <span className="block font-medium">Mantener activo al cerrar la ventana</span>
              <span className="text-muted-foreground">
                Al cerrar la interfaz, el proceso local permanece disponible para ejecuciones programadas.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={isSaving} onClick={saveProfile}>
            <Save className="h-4 w-4" />
            Guardar preferencias
          </Button>
        </div>
        {saveError ? <p className="mt-3 text-sm text-danger">{saveError}</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sesion local</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cerrar sesion detiene la disponibilidad automatica de tus Agentes WS hasta volver a entrar.
            </p>
          </div>
          <Button variant="danger" onClick={requestLogout}>
            <LogOut className="h-4 w-4" />
            Cerrar sesion
          </Button>
        </div>
      </section>

      {showLogoutWarning ? (
        <Modal title="Antes de cerrar sesion" onClose={() => setShowLogoutWarning(false)}>
          <div className="grid gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Si cierras sesion, los Agentes WS configurados no se dispararan automaticamente hasta que vuelvas a iniciar sesion en este equipo.
            </p>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={hideLogoutWarning}
                onChange={(event) => setHideLogoutWarning(event.target.checked)}
              />
              No mostrar esta advertencia nuevamente
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowLogoutWarning(false)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmLogout}>
                Cerrar sesion
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
