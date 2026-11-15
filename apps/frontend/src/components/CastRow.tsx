import type { CastMember } from "../lib/types";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { PAGE_X } from "../lib/layout";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** One person: headshot (or their initials), name, and the part they played. */
function CastCard({ member }: { member: CastMember }) {
  const { url } = useAuthedImage(member.imagePath);
  return (
    <li className="w-[112px] shrink-0 sm:w-[128px]">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-divider bg-surface">
        {url ? (
          <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <span className="font-display text-2xl tracking-wide text-white/15" aria-hidden="true">
              {initials(member.name)}
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold leading-snug text-white">{member.name}</p>
      {member.character && <p className="text-xs leading-snug text-text-tertiary">{member.character}</p>}
    </li>
  );
}

/**
 * The billed cast, as a row that scrolls sideways on a phone and simply runs along the page on a
 * desktop. Renders nothing when the title isn't matched or TMDb lists nobody, so a page without a
 * cast has no empty section on it.
 */
export default function CastRow({
  cast,
  variant = "page",
}: {
  cast: CastMember[] | undefined;
  /** "page" is a section of a detail page, with the page gutter and a display heading; "inline"
   * sits inside a card that already has its own padding. */
  variant?: "page" | "inline";
}) {
  if (!cast || cast.length === 0) return null;
  const page = variant === "page";
  return (
    <section className={page ? `${PAGE_X} pt-8` : "pt-5"} aria-labelledby="cast-heading">
      <h2
        id="cast-heading"
        className={page ? "mb-4 font-display text-2xl tracking-wide text-white" : "mb-3 text-sm font-semibold text-white"}
      >
        Cast
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2 sm:gap-4" style={{ scrollbarWidth: "thin" }}>
        {cast.map((member, index) => (
          <CastCard key={`${member.name}-${index}`} member={member} />
        ))}
      </ul>
    </section>
  );
}
