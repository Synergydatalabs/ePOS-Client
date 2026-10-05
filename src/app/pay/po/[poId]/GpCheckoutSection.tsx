// Global Payments Drop-In — client-side section for the /pay/po/[poId] page.
//
// Renders when the payment link's ?processor=GP query param is set.
//
// Delegates the full card-form + wallet UI to the shared DropInCheckout
// component (same one used on invoice pay / demo pages). On a successful
// GP charge, we fire the existing /mock-pay endpoint — same single state
// transition path the mock + webhook flows use — to mark the PO PAID.
// Rename is deliberate: /mock-pay is the "mark as paid" endpoint, not a
// mock-only path. Keeping the URL stable avoids churning three callers.

"use client";

import DropInCheckout from "@/components/pay/DropInCheckout";
import { toast } from "sonner";

interface Props {
  poId: string;
  ref_: string;
  amountCents: number;
  currency: string;
  merchantName: string;
  description: string;
  onPaid: () => void;
}

export default function GpCheckoutSection({
  poId,
  ref_,
  amountCents,
  currency,
  merchantName,
  description,
  onPaid,
}: Props) {
  return (
    <div>
      <DropInCheckout
        orderId={poId}
        amount={amountCents}
        currency={currency}
        description={description}
        merchantName={merchantName}
        onSuccess={async (result) => {
          // GP captured the funds on the supplier's account. Now mark the
          // PO paid on our side so the pay page flips to the success view
          // and the "paid" email + inventory sync fire.
          try {
            const res = await fetch(`/api/pay/po/${poId}/mock-pay`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ref: ref_,
                processorReference: result.transactionId,
                paidMethod: result.cardBrand
                  ? `card_${result.cardBrand.toLowerCase()}`
                  : "card",
              }),
            });
            if (!res.ok) {
              // Rare — the GP charge went through but our DB didn't catch
              // up. Surface it so the operator reconciles manually; funds
              // are already with the supplier.
              const data = await res.json().catch(() => ({}));
              toast.error(
                data.error ||
                  "Payment captured but could not update the PO status. Contact the supplier with the transaction id."
              );
              return;
            }
            toast.success("Payment successful");
            onPaid();
          } catch (err) {
            toast.error(
              `Payment captured but our server couldn't update the PO: ${(err as Error).message}`
            );
          }
        }}
        onError={(message) => toast.error(message)}
      />
    </div>
  );
}
