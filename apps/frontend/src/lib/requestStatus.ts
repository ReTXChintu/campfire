import type { RequestStatus } from "./types";

/** One status vocabulary, shared by the community board and the admin list, so a requester and the
 * admin are reading the same word in the same colour (the approved prototype's status pills). */
export const REQUEST_STATUSES: RequestStatus[] = ["new", "planned", "sourcing", "added", "declined"];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  planned: "Planned",
  sourcing: "Sourcing",
  added: "Added",
  declined: "Declined",
};

export const REQUEST_STATUS_CLASSES: Record<RequestStatus, string> = {
  new: "border-accent-dim bg-accent-soft text-accent",
  planned: "border-amber/35 bg-amber/10 text-amber",
  sourcing: "border-info/35 bg-info-soft text-info",
  added: "border-live/35 bg-live/10 text-live",
  declined: "border-danger/35 bg-danger-soft text-danger",
};
