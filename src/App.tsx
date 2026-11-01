import { Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import Shell from "./components/Shell";
import NoticesPage from "./pages/NoticesPage";
import PayPage from "./pages/PayPage";
import DirectoryPage from "./pages/DirectoryPage";
import ReceiptPage from "./pages/ReceiptPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <ToastProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<PayPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/history" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </ToastProvider>
  );
}
