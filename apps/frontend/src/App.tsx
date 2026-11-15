import { Routes, Route } from "react-router-dom";
import TopBar from "./components/TopBar";
import { ProtectedRoute, AdminRoute } from "./components/ProtectedRoute";
import LoginPage from "./routes/LoginPage";
import ResetPasswordPage from "./routes/ResetPasswordPage";
import LibraryPage from "./routes/LibraryPage";
import FolderPage from "./routes/FolderPage";
import WatchPage from "./routes/WatchPage";
import LinkDevicePage from "./routes/LinkDevicePage";
import NotFoundPage from "./routes/NotFoundPage";
import RequestsPage from "./routes/RequestsPage";
import AdminCatalogPage from "./routes/admin/AdminCatalogPage";
import AdminRequestsPage from "./routes/admin/AdminRequestsPage";
import AdminCatalogFolderPage from "./routes/admin/AdminCatalogFolderPage";
import AdminCatalogVideoPage from "./routes/admin/AdminCatalogVideoPage";

export default function App() {
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <LibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/folder/:folderId"
          element={
            <ProtectedRoute>
              <FolderPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/watch/:fileId"
          element={
            <ProtectedRoute>
              <WatchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requests"
          element={
            <ProtectedRoute>
              <RequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/link"
          element={
            <ProtectedRoute>
              <LinkDevicePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminCatalogPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <AdminRoute>
              <AdminCatalogPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/requests"
          element={
            <AdminRoute>
              <AdminRequestsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/catalog/folder/:folderId"
          element={
            <AdminRoute>
              <AdminCatalogFolderPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/catalog/video/:fileId"
          element={
            <AdminRoute>
              <AdminCatalogVideoPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
