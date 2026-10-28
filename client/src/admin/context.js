/**
 * The owner session context.
 *
 * Kept in its own module so the provider (a component file) and the hook
 * (a non-component file) can both import it without either of them exporting a
 * mix of components and plain values.
 */
import { createContext } from "react";

export const AdminContext = createContext(null);
