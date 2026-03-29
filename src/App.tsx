import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import VolunteerDashboard from "./pages/VolunteerDashboard";
import BrowseShifts from "./pages/BrowseShifts";
import ShiftHistory from "./pages/ShiftHistory";
import CoordinatorDashboard from "./pages/CoordinatorDashboard";
import ManageShifts from "./pages/ManageShifts";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUsers from "./pages/AdminUsers";
import AdminReminders from "./pages/AdminReminders";
import AdminSettings from "./pages/AdminSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string[] }) {
  const { user, role, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (requiredRole && role && !requiredRole.includes(role)) {
    if (role === "coordinator") return <Navigate to="/coordinator" replace />;
    if (role === "admin") return <Navigate to="/admin" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route path="/dashboard" element={<ProtectedRoute requiredRole={["volunteer"]}><VolunteerDashboard /></ProtectedRoute>} />
            <Route path="/shifts" element={<ProtectedRoute requiredRole={["volunteer"]}><BrowseShifts /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute requiredRole={["volunteer"]}><ShiftHistory /></ProtectedRoute>} />

            <Route path="/coordinator" element={<ProtectedRoute requiredRole={["coordinator", "admin"]}><CoordinatorDashboard /></ProtectedRoute>} />
            <Route path="/coordinator/manage" element={<ProtectedRoute requiredRole={["coordinator", "admin"]}><ManageShifts /></ProtectedRoute>} />

            <Route path="/admin" element={<ProtectedRoute requiredRole={["admin"]}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requiredRole={["admin"]}><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/reminders" element={<ProtectedRoute requiredRole={["admin"]}><AdminReminders /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute requiredRole={["admin"]}><AdminSettings /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
