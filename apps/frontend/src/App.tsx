import { Suspense } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import TopBar from "./components/TopBar";
import { ProtectedRoute, AdminRoute } from "./components/ProtectedRoute";
import { lazyRoute } from "./lib/lazyRoute";
import { PAGE_X } from "./lib/layout";

// Loaded up front: the pages almost every visit opens first — signing in, the library, browsing,
// a title's page — plus the 404, which has to render even when a chunk can't be fetched.
import LoginPage from "./routes/LoginPage";
import LibraryPage from "./routes/LibraryPage";
import BrowsePage from "./routes/BrowsePage";
import FolderPage from "./routes/FolderPage";
import NotFoundPage from "./routes/NotFoundPage";

// Loaded when first opened. The player carries LiveKit (watch-party voice and video), the
// heaviest thing in the app, and the admin pages are only ever opened by one person — neither has
// any business in the bundle every viewer downloads on their first visit.
const WatchPage = lazyRoute(() => import("./routes/WatchPage"));
const RequestsPage = lazyRoute(() => import("./routes/RequestsPage"));
const ExplorePage = lazyRoute(() => import("./routes/ExplorePage"));
const SettingsPage = lazyRoute(() => import("./routes/SettingsPage"));
const LinkDevicePage = lazyRoute(() => import("./routes/LinkDevicePage"));
const ResetPasswordPage = lazyRoute(() => import("./routes/ResetPasswordPage"));
const AdminOverviewPage = lazyRoute(() => import("./routes/admin/AdminOverviewPage"));
const AdminCatalogPage = lazyRoute(() => import("./routes/admin/AdminCatalogPage"));
const AdminRequestsPage = lazyRoute(() => import("./routes/admin/AdminRequestsPage"));
const AdminCatalogFolderPage = lazyRoute(() => import("./routes/admin/AdminCatalogFolderPage"));
const AdminCatalogVideoPage = lazyRoute(() => import("./routes/admin/AdminCatalogVideoPage"));

/** What shows for the moment a page's code is still arriving: the same page frame, empty. */
function RouteFallback() {
  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`} aria-busy="true">
      <div className="skeleton h-10 w-56 rounded-lg" />
      <div className="skeleton mt-6 h-64 w-full rounded-xl" />
    </main>
  );
}

export default function App() {
  return (
    <>
      <TopBar />
      <Suspense fallback={<RouteFallback />}>
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
            path="/discover"
            element={
              <ProtectedRoute>
                <BrowsePage />
              </ProtectedRoute>
            }
          />
          {/* The old separate shelves, kept so bookmarks land on the right chip. */}
          <Route path="/series" element={<Navigate to="/discover?type=series" replace />} />
          <Route path="/movies" element={<Navigate to="/discover?type=movies" replace />} />
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
            path="/explore"
            element={
              <ProtectedRoute>
                <ExplorePage />
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
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
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
                <AdminOverviewPage />
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
      </Suspense>
    </>
  );
}
