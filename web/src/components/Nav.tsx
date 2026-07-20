import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import StudioIcon from "./StudioIcon.js";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = menuRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function closeMenu() {
    menuButtonRef.current?.focus();
    setOpen(false);
  }

  function go(path: string) {
    navigate(path);
    setOpen(false);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  const screen =
    location.pathname === "/history"
      ? "history"
      : location.pathname.startsWith("/admin")
        ? "admin"
        : location.pathname === "/"
          ? "new"
          : "recipe";

  return (
    <>
      <header className="site-header">
        <button
          type="button"
          className="brand"
          onClick={() => go("/")}
          aria-label="Bean to Bloom home"
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>Bean to Bloom</strong>
            <small>For xBloom Studio</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="Main navigation">
          <button
            type="button"
            className={screen === "new" ? "active" : ""}
            aria-current={screen === "new" ? "page" : undefined}
            onClick={() => go("/")}
          >
            New Recipe
          </button>
          <button
            type="button"
            className={screen === "history" ? "active" : ""}
            aria-current={screen === "history" ? "page" : undefined}
            onClick={() => go("/history")}
          >
            History
          </button>
          {user?.role === "admin" ? (
            <button
              type="button"
              className={screen === "admin" ? "active" : ""}
              aria-current={screen === "admin" ? "page" : undefined}
              onClick={() => go("/admin")}
            >
              Admin Dashboard
            </button>
          ) : null}
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </nav>

        <button
          ref={menuButtonRef}
          type="button"
          className="menu-button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => (open ? closeMenu() : setOpen(true))}
        >
          <StudioIcon name={open ? "close" : "menu"} />
        </button>
      </header>

      {open ? (
        <dialog
          open
          className="mobile-menu-backdrop m-0 h-full max-h-none w-full max-w-none border-0 p-0"
          aria-label="Mobile navigation"
        >
          <nav
            ref={menuRef}
            id="mobile-navigation"
            className="mobile-menu"
            aria-label="Mobile navigation links"
          >
            <div className="mobile-menu-heading">
              <span>Navigate</span>
              <button type="button" aria-label="Close menu" onClick={closeMenu}>
                <StudioIcon name="close" />
              </button>
            </div>
            <button
              type="button"
              aria-current={screen === "new" ? "page" : undefined}
              onClick={() => go("/")}
            >
              New Recipe <StudioIcon name="arrow" />
            </button>
            <button
              type="button"
              aria-current={screen === "history" ? "page" : undefined}
              onClick={() => go("/history")}
            >
              History <StudioIcon name="arrow" />
            </button>
            {user?.role === "admin" ? (
              <button
                type="button"
                aria-current={screen === "admin" ? "page" : undefined}
                onClick={() => go("/admin")}
              >
                Admin Dashboard <StudioIcon name="arrow" />
              </button>
            ) : null}
            <button type="button" onClick={handleLogout}>
              Logout <StudioIcon name="arrow" />
            </button>
          </nav>
        </dialog>
      ) : null}
    </>
  );
}
