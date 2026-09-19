import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./pages/Home";
import { Generations } from "./pages/Generations";
import { Login } from "./pages/Login";
import { getToken, subscribeSession } from "./lib/api";

export default function App() {
  const [sessionVersion, setSessionVersion] = useState(0);
  const location = useLocation();

  useEffect(() => subscribeSession(() => setSessionVersion((v) => v + 1)), []);
  useEffect(() => {
    const handler = () => setSessionVersion((v) => v + 1);
    window.addEventListener("studio:refetch", handler);
    return () => window.removeEventListener("studio:refetch", handler);
  }, []);

  const signedIn = getToken() !== null || location.pathname === "/login";
  if (!signedIn) {
    return <Login />;
  }

  return (
    <div className="flex h-full" data-session-version={sessionVersion}>
      {location.pathname === "/login" ? (
        <Navigate to="/" replace />
      ) : (
        <>
          <Sidebar />
          <main className="dot-grid relative flex-1 overflow-y-auto scroll-thin">
            <Routes key={sessionVersion}>
              <Route path="/" element={<Home />} />
              <Route path="/generations" element={<Generations mode="all" />} />
              <Route path="/favorites" element={<Generations mode="favorites" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </>
      )}
    </div>
  );
}
