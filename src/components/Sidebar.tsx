import type { ReactNode } from "react";
import {
  Building2,
  CirclePlus,
  Gauge,
  Home,
  LayoutList,
  MessageSquareText,
  Settings,
  Users,
} from "lucide-react";
import { Button } from "./ui/Button";
import type { UserProfile } from "../lib/types";

export type AppSection = "dashboard" | "properties" | "leads" | "templates" | "settings" | "userSettings";

type SidebarProps = {
  user: UserProfile;
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
  onAddProperty: () => void;
  onAddLead: () => void;
};

const navItems: Array<{ id: AppSection; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Panel principal", icon: <Home className="h-4 w-4" /> },
  { id: "properties", label: "Inmuebles", icon: <LayoutList className="h-4 w-4" /> },
  { id: "leads", label: "Leads", icon: <Users className="h-4 w-4" /> },
  { id: "templates", label: "Plantillas", icon: <MessageSquareText className="h-4 w-4" /> },
  { id: "settings", label: "Configuracion", icon: <Settings className="h-4 w-4" /> },
];

export function Sidebar({ user, activeSection, onNavigate, onAddProperty, onAddLead }: SidebarProps) {
  return (
    <aside className="flex h-screen w-full flex-col border-r border-border bg-white p-4 md:w-72">
      <div className="mb-9 flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Building2 className="h-8 w-8" />
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-normal">Immobil-IA</p>
          <p className="mt-1 text-lg text-muted-foreground">MVP local v0.1</p>
        </div>
      </div>

      <nav className="grid gap-2 text-sm">
        {navItems.map((item) => (
          <button
            className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left font-medium transition ${
              activeSection === item.id ? "bg-muted text-foreground" : "text-foreground hover:bg-muted"
            }`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto grid gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          Ingreso manual
        </p>
        <Button variant="secondary" onClick={onAddProperty}>
          <CirclePlus className="h-4 w-4" />
          Agregar inmueble
        </Button>
        <Button variant="secondary" onClick={onAddLead}>
          <CirclePlus className="h-4 w-4" />
          Agregar lead
        </Button>
      </div>

      <button
        className={`mt-4 rounded-lg border border-border p-3 text-left text-sm transition hover:bg-muted ${
          activeSection === "userSettings" ? "bg-muted" : "bg-white"
        }`}
        onClick={() => onNavigate("userSettings")}
      >
        <p className="font-medium">{user.name}</p>
        <p className="mt-1 text-muted-foreground">
          {user.city}, {user.country}
        </p>
        <p className="mt-2 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
          Plan {user.plan}
        </p>
      </button>
    </aside>
  );
}
