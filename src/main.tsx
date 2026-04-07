import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import "./index.css";

// Detect Trusted Web Activity (Android app) context
const isTWA = document.referrer.startsWith("android-app://");
if (isTWA) {
  document.documentElement.classList.add("twa");
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <App />
  </ThemeProvider>
);
