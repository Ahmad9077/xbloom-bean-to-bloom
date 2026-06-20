import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav
      className="bg-espresso text-ivory px-4 py-3 flex items-center gap-4"
      aria-label="Main navigation"
    >
      <Link
        to="/"
        className="font-heading text-lg text-ivory hover:text-ivory/80 transition-colors mr-auto"
        aria-label="xBloom Brew Studio — home"
      >
        xBloom
      </Link>

      <Link
        to="/"
        className="font-body text-xs font-semibold uppercase tracking-widest text-ivory/70
                   hover:text-ivory transition-colors focus-visible:outline-2 focus-visible:outline-ivory"
      >
        New Recipe
      </Link>

      <Link
        to="/history"
        className="font-body text-xs font-semibold uppercase tracking-widest text-ivory/70
                   hover:text-ivory transition-colors focus-visible:outline-2 focus-visible:outline-ivory"
      >
        History
      </Link>

      {user?.role === "admin" && (
        <Link
          to="/admin"
          className="font-body text-xs font-semibold uppercase tracking-widest text-ivory/70
                     hover:text-ivory transition-colors focus-visible:outline-2 focus-visible:outline-ivory"
        >
          Admin Dashboard
        </Link>
      )}

      <button
        type="button"
        onClick={handleLogout}
        className="font-body text-xs font-semibold uppercase tracking-widest text-ivory/70
                   hover:text-ivory transition-colors focus-visible:outline-2 focus-visible:outline-ivory"
      >
        Logout
      </button>
    </nav>
  );
}
