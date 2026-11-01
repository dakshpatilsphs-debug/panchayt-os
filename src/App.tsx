import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import Shell from "./components/Shell";
import NoticesPage from "./pages/NoticesPage";
import PayPage from "./pages/PayPage";
import HistoryPage from "./pages/HistoryPage";
import ReceiptPage from "./pages/ReceiptPage";
import AdminPage from "./pages/AdminPage";
import { useSession } from "./lib/session";

/** No accounts, no PINs — but "My payments" needs to know WHICH flat: the
 *  browser's quiet flat memory, picked on the Pay page. No memory → go pick. */
function RequireFlat() {
  const session = useSession();
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <ToastProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<PayPage />} />
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route element={<RequireFlat />}>
            <Route path="/history" element={<HistoryPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </ToastProvider>
  );
}
