import { env } from "../config/env";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === env.adminEmail;
}
