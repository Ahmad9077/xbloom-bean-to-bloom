import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import Nav from "./components/Nav.js";
import ProtectedRoute, { AdminRoute } from "./components/ProtectedRoute.js";
import { AuthProvider } from "./context/AuthContext.js";
import AdminPage from "./pages/AdminPage.js";
import HistoryPage from "./pages/HistoryPage.js";
import LoginPage from "./pages/LoginPage.js";
import NewRecipePage from "./pages/NewRecipePage.js";
import RecipePage from "./pages/RecipePage.js";

function AppLayout() {
  return (
    <>
      <Nav />
      <Outlet />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<NewRecipePage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="recipes/:id" element={<RecipePage />} />
              <Route element={<AdminRoute />}>
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
