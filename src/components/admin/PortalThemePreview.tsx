import type { PortalThemeId } from "@/lib/portal-themes";

/** Kleine Wireframe-Vorschau der Portal-Designs für die Auswahl im Landing-Generator. */
export default function PortalThemePreview({ id }: { id: PortalThemeId }) {
  const base = "h-20 w-full rounded-md overflow-hidden border border-border flex";

  if (id === "office" || id === "atmosphere") {
    return (
      <div className={`${base} bg-muted items-center justify-center p-2 relative`}>
        <div className="absolute inset-0 bg-foreground/35" />
        <div className="absolute top-1.5 left-1.5 h-2 w-8 rounded bg-card/80" />
        <div className={`w-3/4 rounded border border-border bg-card/90 p-2 space-y-1 shadow ${id === "atmosphere" ? "backdrop-blur" : ""}`}>
          <div className="h-1.5 w-10 rounded bg-foreground/40" />
          <div className="h-2 w-full rounded bg-muted" />
          <div className="h-2 w-full rounded bg-muted" />
          <div className="h-2 w-full rounded bg-primary/70" />
        </div>
      </div>
    );
  }

  return (
    <div className={`${base} bg-muted/40 items-center justify-center p-2 relative`}>
      <div className="absolute top-1.5 left-1.5 h-2 w-8 rounded bg-primary/40" />
      <div className="w-3/4 rounded border border-border bg-card p-2 space-y-1">
        <div className="h-2 w-full rounded bg-muted" />
        <div className="h-2 w-full rounded bg-muted" />
        <div className="h-2 w-full rounded bg-primary/70" />
      </div>
    </div>
  );
}
