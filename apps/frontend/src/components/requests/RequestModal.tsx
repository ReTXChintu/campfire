import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import type { PublicRequest, RequestRefMeta } from "../../lib/types";
import { useLibrary } from "../../hooks/useCatalog";
import {
  useCreateRequest,
  useRequestMatch,
  useResolveLink,
  useToggleUpvote,
  useUploadReferenceImage,
} from "../../hooks/useRequests";
import RequestStatusPill from "./RequestStatusPill";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A request is two fields: a title plus one reference. There is deliberately no type toggle, no
 * year, no seasons, no quality chips and no note — the backend doesn't accept them (see the API
 * contract), and the extra fields were the reason the old prototype form felt like paperwork. */
type RefTab = "link" | "image";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function errorFor(error: unknown, field: string): string | null {
  if (error instanceof ApiError && error.field === field) return error.message;
  return null;
}

function generalError(error: unknown, knownFields: string[]): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.field && knownFields.includes(error.field)) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

export default function RequestModal({
  open,
  onClose,
  onSeeMine,
  initialTitle = "",
}: {
  open: boolean;
  onClose: () => void;
  /** Offered from the success state, when the caller has a "My requests" view to switch to. */
  onSeeMine?: () => void;
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [refTab, setRefTab] = useState<RefTab>("link");
  const [link, setLink] = useState("");
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [linkMeta, setLinkMeta] = useState<RequestRefMeta | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [created, setCreated] = useState<PublicRequest | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const debouncedTitle = useDebounced(title, 350);
  const debouncedLink = useDebounced(link, 500);

  const { data: match } = useRequestMatch(debouncedTitle);
  const { data: library } = useLibrary();
  const resolveLink = useResolveLink();
  const uploadImage = useUploadReferenceImage();
  const createRequest = useCreateRequest();
  const toggleUpvote = useToggleUpvote();

  // "Already in your library" is a client-side check against the catalog this page already holds —
  // there's no server endpoint for it, and asking for something you can already watch is the one
  // mistake worth catching before the form is even submitted.
  const libraryMatch = useMemo(() => {
    const needle = debouncedTitle.trim().toLowerCase();
    if (needle.length < 2 || !library) return null;
    const all = [...library.folders, ...library.videos];
    return (
      all.find((item) => item.name.toLowerCase() === needle) ??
      all.find((item) => item.name.toLowerCase().startsWith(needle)) ??
      null
    );
  }, [debouncedTitle, library]);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setRefTab("link");
    setLink("");
    setLinkConfirmed(false);
    setLinkMeta(null);
    setImageId(null);
    setImageName(null);
    setImageError(null);
    setCreated(null);
    createRequest.reset();
    resolveLink.reset();
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
    // Resetting is keyed on opening, not on every mutation-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTitle]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Object URLs for the local preview are owned here; the uploaded copy is fetched back through
  // useAuthedImage everywhere else.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  /** The pasted link is checked as it's typed (debounced): the server either says it isn't an
   * IMDb/TMDb title link, or hands back the preview card's contents to confirm. */
  useEffect(() => {
    const trimmed = debouncedLink.trim();
    setLinkConfirmed(false);
    setLinkMeta(null);
    resolveLink.reset();
    if (refTab !== "link" || trimmed.length < 8) return;
    let cancelled = false;
    resolveLink
      .mutateAsync(trimmed)
      .then((result) => {
        if (cancelled) return;
        setLinkMeta(result.meta);
        // No TMDB key configured, or a link we can validate but not enrich: the link is still
        // good, so take it quietly rather than showing an empty preview card to confirm.
        if (!result.meta) setLinkConfirmed(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLink, refTab]);

  if (!open) return null;

  const linkInvalid =
    resolveLink.isError && resolveLink.error instanceof ApiError && resolveLink.error.status === 400;

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    if (!file.type.startsWith("image/")) {
      setImageError("Attach a PNG, JPEG, WebP or GIF image");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("That image is over 5 MB — attach a smaller one");
      return;
    }
    try {
      const result = await uploadImage.mutateAsync(file);
      setImageId(result.imageId);
      setImageName(file.name);
      setImagePreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "That upload didn't go through");
    }
  }

  async function onSubmit() {
    const result = await createRequest
      .mutateAsync({
        title: title.trim(),
        ...(refTab === "link" && link.trim() ? { refLink: link.trim() } : {}),
        ...(refTab === "image" && imageId ? { refImageId: imageId } : {}),
      })
      .catch(() => null);
    if (result) setCreated(result.request);
  }

  const submitting = createRequest.isPending;
  const titleError = errorFor(createRequest.error, "title");
  const refError =
    errorFor(createRequest.error, "reference") ??
    errorFor(createRequest.error, "refLink") ??
    errorFor(createRequest.error, "refImage");
  const bannerError = generalError(createRequest.error, ["title", "reference", "refLink", "refImage"]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="request-modal-title">
      <button
        type="button"
        className="fixed inset-0 h-full w-full cursor-default bg-black/70 backdrop-blur-sm"
        aria-label="Close the request form"
        onClick={onClose}
      />
      {/* Modals are the one thing the full-width rule exempts, so this box stays centred. */}
      <div className="relative mx-auto my-6 flex w-[calc(100%-1.5rem)] max-w-xl flex-col rounded-2xl border border-divider-strong bg-[var(--bg-elevated)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-divider px-5 py-4">
          <h2 id="request-modal-title" className="flex-1 font-display text-2xl tracking-wide text-white">
            {created ? "Request submitted" : "Request a title"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-text-secondary transition hover:text-white"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {created ? (
          <div className="grid gap-4 px-5 py-8 text-center">
            <p className="text-sm text-text-secondary">
              <span className="font-semibold text-white">“{created.title}”</span> is on the board with the status{" "}
              <RequestStatusPill status={created.status} />. You'll see the status change under My requests — Campfire
              doesn't send email, the status in the app is the notification.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-divider-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Close
              </button>
              {onSeeMine && (
                <button
                  type="button"
                  onClick={() => {
                    onSeeMine();
                    onClose();
                  }}
                  className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                >
                  See my requests
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-5 px-5 py-5">
              {bannerError && (
                <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {bannerError}
                </p>
              )}

              <div className="grid gap-1.5">
                <label htmlFor="request-title" className="text-xs font-semibold text-text-secondary">
                  Title <span className="text-text-tertiary">(required)</span>
                </label>
                <input
                  id="request-title"
                  ref={titleRef}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoComplete="off"
                  placeholder="Start typing — we check your library first"
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? "request-title-error" : undefined}
                  className={`min-h-[42px] w-full rounded-md border bg-background px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent ${
                    titleError ? "border-danger" : "border-divider-strong"
                  }`}
                />
                {titleError && (
                  <p id="request-title-error" className="text-xs text-danger">
                    {titleError}
                  </p>
                )}
                {libraryMatch && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber/35 bg-amber/10 px-3 py-2 text-xs text-amber">
                    <span>
                      <b>{libraryMatch.name}</b> is already in your library.
                    </span>
                    <Link
                      to={libraryMatch.kind === "folder" ? `/folder/${libraryMatch.id}` : `/watch/${libraryMatch.id}`}
                      onClick={onClose}
                      className="font-semibold underline"
                    >
                      Open it
                    </Link>
                  </div>
                )}
                {!libraryMatch && match?.match && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber/35 bg-amber/10 px-3 py-2 text-xs text-amber">
                    <span>
                      <b>{match.match.title}</b> has already been asked for by {match.match.wantCount}{" "}
                      {match.match.wantCount === 1 ? "person" : "people"}.
                    </span>
                    <button
                      type="button"
                      className="font-semibold underline disabled:opacity-60"
                      disabled={toggleUpvote.isPending}
                      onClick={async () => {
                        const id = match.match!.id;
                        await toggleUpvote.mutateAsync({ id, wantsIt: true }).catch(() => null);
                        onClose();
                      }}
                    >
                      Add my vote instead
                    </button>
                  </div>
                )}
              </div>

              <fieldset
                className={`grid gap-3 rounded-xl border p-4 ${refError ? "border-danger" : "border-divider-strong"}`}
              >
                <legend className="px-1 text-xs font-bold text-white">Help us identify it</legend>
                <p className="-mt-1 text-xs text-text-tertiary">
                  A link or a poster image tells the admin exactly which release you mean. One of the two is required.
                </p>
                <div className="flex gap-1 border-b border-divider" role="tablist" aria-label="Reference type">
                  {(["link", "image"] as RefTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={refTab === tab}
                      onClick={() => setRefTab(tab)}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                        refTab === tab
                          ? "border-accent text-white"
                          : "border-transparent text-text-secondary hover:text-white"
                      }`}
                    >
                      {tab === "link" ? "Link" : "Image"}
                    </button>
                  ))}
                </div>

                {refTab === "link" ? (
                  <div className="grid gap-2">
                    <label htmlFor="request-link" className="text-xs font-semibold text-text-secondary">
                      IMDb or TMDb link
                    </label>
                    <input
                      id="request-link"
                      value={link}
                      onChange={(event) => setLink(event.target.value)}
                      placeholder="https://www.imdb.com/title/tt4512300/"
                      aria-invalid={linkInvalid || refError ? true : undefined}
                      className={`min-h-[42px] w-full rounded-md border bg-background px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent ${
                        linkInvalid || refError ? "border-danger" : "border-divider-strong"
                      }`}
                    />
                    {resolveLink.isPending && <p className="text-xs text-text-tertiary">Looking it up…</p>}
                    {linkInvalid && (
                      <p className="text-xs text-danger">
                        {resolveLink.error instanceof Error ? resolveLink.error.message : "That link isn't supported"}
                      </p>
                    )}
                    {linkMeta && (
                      <div className="grid gap-2 rounded-md bg-surface p-3">
                        <div className="flex gap-3">
                          {linkMeta.posterUrl && (
                            <img
                              src={linkMeta.posterUrl}
                              alt=""
                              className="h-[84px] w-14 shrink-0 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                              {linkMeta.title}
                              {linkMeta.year ? ` (${linkMeta.year})` : ""}
                            </p>
                            {linkMeta.overview && (
                              <p className="mt-1 line-clamp-3 text-xs text-text-secondary">{linkMeta.overview}</p>
                            )}
                          </div>
                        </div>
                        {linkConfirmed ? (
                          <p className="rounded border border-live/30 bg-live/10 px-2 py-1 text-xs text-live">
                            Confirmed as the reference
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setLinkConfirmed(true);
                                if (!title.trim()) setTitle(linkMeta.title);
                              }}
                              className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
                            >
                              Looks right
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setLink("");
                                setLinkMeta(null);
                              }}
                              className="rounded-md px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:text-white"
                            >
                              Not this one
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {!linkMeta && !resolveLink.isPending && !linkInvalid && linkConfirmed && (
                      <p className="text-xs text-text-tertiary">
                        That link checks out — we couldn't pull its details, but the admin can open it.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold text-text-secondary">Poster or screenshot</p>
                    {imagePreview ? (
                      <div className="flex items-center gap-3 rounded-md bg-surface p-3">
                        <img src={imagePreview} alt="Reference image preview" className="h-[84px] w-14 rounded object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{imageName}</p>
                          <p className="text-xs text-text-tertiary">Attached</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setImageId(null);
                            setImageName(null);
                            setImagePreview((previous) => {
                              if (previous) URL.revokeObjectURL(previous);
                              return null;
                            });
                          }}
                          className="rounded-md border border-danger px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger-soft"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-divider-strong bg-background px-4 py-6 text-center">
                        <p className="text-sm font-semibold text-white">Choose an image</p>
                        <p className="text-xs text-text-tertiary">PNG, JPEG, WebP or GIF, up to 5 MB</p>
                        <input
                          id="request-image"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="sr-only"
                          onChange={(event) => onPickImage(event.target.files?.[0])}
                        />
                        <label
                          htmlFor="request-image"
                          className="cursor-pointer rounded-md border border-divider-strong px-4 py-2 text-xs font-semibold text-white transition hover:bg-surface-hover"
                        >
                          {uploadImage.isPending ? "Uploading…" : "Choose file"}
                        </label>
                      </div>
                    )}
                    {imageError && <p className="text-xs text-danger">{imageError}</p>}
                  </div>
                )}
                {refError && <p className="text-xs text-danger">{refError}</p>}
              </fieldset>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-divider px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2.5 text-sm font-semibold text-text-secondary transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting}
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
