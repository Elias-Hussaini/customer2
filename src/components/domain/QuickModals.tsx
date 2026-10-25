import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { uiActions, useUiStore } from "../layout/uiStore";
import { CustomerFormModal } from "./CustomerFormModal";
import { RepresentativeFormModal } from "./RepresentativeFormModal";
import { ListFormModal } from "./ListFormModal";
import { PaymentFormModal } from "./PaymentFormModal";

/**
 * Hosts the globally-triggered quick-create modals (from the top bar "+" menu
 * and quick actions). Request creation navigates to the full-page form.
 */
export function QuickModals() {
  const quickModal = useUiStore((s) => s.quickModal);
  const navigate = useNavigate();

  // The full request form lives on its own page (it is a large form).
  useEffect(() => {
    if (quickModal?.kind === "request") {
      const params = new URLSearchParams();
      if (quickModal.customerId) params.set("customer", quickModal.customerId);
      if (quickModal.representativeId) params.set("rep", quickModal.representativeId);
      if (quickModal.listId) params.set("list", quickModal.listId);
      const qs = params.toString();
      uiActions.closeQuickModal();
      navigate(`/requests/new${qs ? `?${qs}` : ""}`);
    }
  }, [quickModal, navigate]);

  return (
    <>
      <CustomerFormModal
        open={quickModal?.kind === "customer"}
        onClose={uiActions.closeQuickModal}
        onSaved={(customer) => {
          if (quickModal?.kind === "customer") navigate(`/customers/${customer.id}`);
        }}
      />
      <RepresentativeFormModal
        open={quickModal?.kind === "rep"}
        onClose={uiActions.closeQuickModal}
        onSaved={(rep) => {
          if (quickModal?.kind === "rep") navigate(`/representatives/${rep.id}`);
        }}
      />
      <ListFormModal
        open={quickModal?.kind === "list"}
        onClose={uiActions.closeQuickModal}
        onSaved={(list) => {
          if (quickModal?.kind === "list") navigate(`/lists/${list.id}`);
        }}
      />
      <PaymentFormModal
        open={quickModal?.kind === "payment"}
        onClose={uiActions.closeQuickModal}
      />
    </>
  );
}
