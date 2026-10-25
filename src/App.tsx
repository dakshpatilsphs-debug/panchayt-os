import { Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import Shell from "./components/Shell";
import PayPage from "./pages/PayPage";
import HistoryPage from "./pages/HistoryPage";
import ReceiptPage from "./pages/ReceiptPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <ToastProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<PayPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </ToastProvider>
  );
}
