// Alias: /bewerbungen → /bewerbung (Bewerber tippen die Mehrzahl-URL).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/bewerbungen")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/bewerbung", search: search as never, replace: true });
  },
});
