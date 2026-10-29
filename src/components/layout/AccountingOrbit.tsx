import { useLocation, useNavigate } from "react-router-dom";
import { Calculator } from "lucide-react";

/**
 * دکمهٔ گرد حسابداری — a round floating button pinned to the FAR LEFT edge
 * of the page (the accounting section moved out of the dock; its old slot in
 * the dock is now هوش مصنوعی).
 *
 * Sits above the floating-dock zone, glass-styled like the dock itself, with
 * a hover tooltip and an active glow while inside /accounting.
 */
export function AccountingOrbit() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = location.pathname.startsWith("/accounting");

  return (
    <div className="acc-orbit no-print">
      <button
        type="button"
        aria-label="حسابداری"
        onClick={() => navigate("/accounting")}
        className={`acc-orbit-btn ${active ? "active" : ""}`}
      >
        <Calculator size={22} strokeWidth={2.1} />
        <span className="acc-orbit-tip" aria-hidden>
          حسابداری
        </span>
        <span className="acc-orbit-ring" aria-hidden />
      </button>
    </div>
  );
}
