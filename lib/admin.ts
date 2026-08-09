import { env } from "@/lib/env";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && env.adminEmails.includes(email.toLowerCase());
}
