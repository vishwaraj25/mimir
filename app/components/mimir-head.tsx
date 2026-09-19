"use client";

/**
 * The Mimir mark: a bearded severed head, per the myth this product is
 * named for -- Odin kept Mimir's head and consulted it for knowledge no one
 * living had. Drawn as flat geometric line art (not a rendered bust) so it
 * reads at 20px in the sidebar and at 96px on the overview with the same
 * file, and so it sits comfortably on a light card UI instead of importing
 * the dark, torch-lit mood of a fantasy render.
 *
 * The eyes are the only part that changes. Idle, they are flat and dim --
 * a relic, not looking at anything. While `active` (an investigation is
 * actually running, not a decorative loop), they light amber and pulse:
 * the one visible signal that the agent is, right now, doing something.
 */
export function MimirHead({
  active = false,
  size = 28,
}: {
  active?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={active ? "Mimir, investigating" : "Mimir, idle"}
    >
      {active && (
        <>
          <circle cx="25" cy="30" r="7" fill="var(--agent)" opacity="0.35" className="mimir-glow" />
          <circle cx="39" cy="30" r="7" fill="var(--agent)" opacity="0.35" className="mimir-glow" />
        </>
      )}

      {/* skull / head silhouette */}
      <path
        d="M32 6C20 6 12 15 12 27c0 7 3 12 6 16l-2 9c-.5 2 1 3.5 3 3h4l1 4c.3 1.2 1.3 2 2.5 2h11c1.2 0 2.2-.8 2.5-2l1-4h4c2 .5 3.5-1 3-3l-2-9c3-4 6-9 6-16C52 15 44 6 32 6Z"
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* brow line */}
      <path d="M18 26c3-3 8-4 11-2M46 26c-3-3-8-4-11-2" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />

      {/* eyes */}
      <circle cx="25" cy="30" r="3.4" className={active ? "mimir-eye-active" : "mimir-eye"} />
      <circle cx="39" cy="30" r="3.4" className={active ? "mimir-eye-active" : "mimir-eye"} />

      {/* nose */}
      <path d="M32 32v6l-3 2" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* braided beard, in three sections like the reference relic */}
      <path
        d="M20 44c-1 4-1 8 1 11 1 1.5 3 1 3-.5v-8M32 46v10c0 1.6 1.8 2.2 3 1l2-9M44 44c1 4 1 8-1 11-1 1.5-3 1-3-.5v-8"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* beard bindings */}
      <rect x="18" y="49" width="6" height="3" rx="1" fill="var(--ink)" opacity="0.5" />
      <rect x="40" y="49" width="6" height="3" rx="1" fill="var(--ink)" opacity="0.5" />
    </svg>
  );
}
