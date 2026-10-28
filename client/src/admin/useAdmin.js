/**
 * Read the owner session state. Only valid inside the /admin route tree, where
 * AdminProvider is mounted.
 */
import { useContext } from "react";
import { AdminContext } from "./context.js";

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error("useAdmin must be used inside the /admin route tree");
  }
  return value;
}
