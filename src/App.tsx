import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Dashboard from "./pages/Dashboard";
import Court from "./pages/Court";
import Pricing from "./pages/Pricing";
import RTI from "./pages/RTI";
import CasePrepList from "./pages/CasePrepList";
import CasePrepWorkspace from "./pages/CasePrepWorkspace";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/court" element={<Court />} />
            <Route path="/court/:sessionId" element={<Court />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/rti" element={<RTI />} />
            <Route path="/workspaces" element={<CasePrepList />} />
            <Route path="/workspaces/:id" element={<CasePrepWorkspace />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
