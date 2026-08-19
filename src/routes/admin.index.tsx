import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

import { useAdminData } from "@/contexts/AdminDataContext";
import { Card, CardContent } from "@/components/ui/card";
import { AdminDashboardSkeleton } from "@/components/SkeletonLoaders";
import {
  ArrowRight, FileText, ClipboardList, CalendarDays
} from "lucide-react";
import { useNavigate } from "@/lib/router-compat";


function AdminDashboardPage() {
  const { profiles, applications, assignments, allBookings, kycList, loading } = useAdminData();
  const navigate = useNavigate();

  if (loading) return <AdminDashboardSkeleton />;

  const newApplications = applications.filter((a) => a.status === "neu" || a.status === "eingegangen").length;
  const pendingKyc = kycList.filter((k) => k.status === "eingereicht" || k.status === "in_pruefung").length;
  const pendingReviews = assignments.filter((a) => a.status === "eingereicht" || a.status === "in_pruefung").length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayBookings = allBookings.filter((b) => (b as any).booking_date === todayStr && (b as any).user_id && !(b as any).application_id).length;
  // Fallback if no specific date bookings: count all active employee bookings
  const totalEmployeeBookings = allBookings.filter((b) => (b as any).user_id && !(b as any).application_id && (b as any).status !== 'cancelled').length;
  const activeEmployees = profiles.filter((p) => p.status === "angenommen").length;

  const actionCards = [
    { label: "Bewerbungen", value: newApplications, icon: FileText, path: "/admin/bewerbungen", highlight: newApplications > 0 },
    { label: "Aufgaben zur Prüfung", value: pendingReviews, icon: ClipboardList, path: "/admin/tasks", highlight: pendingReviews > 0 },
    { label: "Mitarbeiter-Termine", value: totalEmployeeBookings, icon: CalendarDays, path: "/admin/appointments", highlight: totalEmployeeBookings > 0 },
    { label: "Mitarbeiter", value: activeEmployees, icon: FileText, path: "/admin/mitarbeiter", highlight: false },
    { label: "Statistik", value: profiles.length, icon: FileText, path: "/admin/statistiken", highlight: false },
  ];

  return (
    <div className="p-5 space-y-6">
      <div>
        <h1 className="text-lg font-heading font-bold text-foreground">Übersicht</h1>
        <p className="text-xs text-muted-foreground">Was jetzt zu tun ist</p>
      </div>


      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        {actionCards.map((c) => (
          <Card
            key={c.label}
            className={`group cursor-pointer hover:border-primary/20 transition-colors ${c.highlight ? "border-destructive/30 bg-destructive/[0.02]" : ""}`}
            onClick={() => navigate(c.path)}
          >
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c.highlight ? "bg-destructive/10" : "bg-muted"}`}>
                  <c.icon className={`h-4 w-4 ${c.highlight ? "text-destructive" : "text-muted-foreground"}`} />
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors" />
              </div>
              <p className={`text-xl font-bold font-heading ${c.highlight && c.value > 0 ? "text-destructive" : "text-foreground"}`}>{c.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      
    </div>
  );
}
