import { type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ModalPortal({ children }: { children: ReactNode }) {
  const target = document.getElementById("modal-root") ?? document.body;
  return createPortal(children, target);
}
