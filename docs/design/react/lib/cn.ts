import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose className strings.
 *   - clsx handles conditionals: cn("a", isActive && "b", { c: x })
 *   - twMerge dedupes conflicting Tailwind utilities ("p-4 p-6" → "p-6")
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
