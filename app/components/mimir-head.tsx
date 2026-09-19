"use client";

/**
 * The Mimir mark: a bearded severed head, per the myth this product is
 * named for -- Odin kept Mimir's head and consulted it for knowledge no
 * one living had.
 *
 * Two real illustrated states, not hand-coded SVG paths (an earlier
 * attempt at drawing this by hand rendered as an unrecognisable blob --
 * this is not a place to fake competence with vector math). The idle
 * artwork was supplied directly; the active variant was derived FROM that
 * same file by locating the exact eye pixels and recolouring them plus
 * adding an additive amber glow, rather than generating a second image
 * independently -- an independent generation would drift in proportions
 * and the crossfade below would visibly jump. Both are transparent PNGs
 * at identical dimensions, so they can be cross-faded in place.
 *
 * `active` should reflect real agent state (an investigation actually
 * running), never a decorative loop -- the whole point of this mark is
 * that its eyes lighting up MEANS something.
 */
export function MimirHead({
  active = false,
  size = 28,
}: {
  active?: boolean;
  size?: number;
}) {
  return (
    <span
      style={{ position: "relative", display: "inline-block", width: size, height: size }}
      role="img"
      aria-label={active ? "Mimir, investigating" : "Mimir, idle"}
    >
      <img
        src="/mascot/mimir-idle.png"
        alt=""
        width={size}
        height={size}
        style={{
          position: "absolute",
          inset: 0,
          width: size,
          height: size,
          objectFit: "contain",
          opacity: active ? 0 : 1,
          transition: "opacity 320ms ease",
        }}
      />
      <img
        src="/mascot/mimir-active.png"
        alt=""
        width={size}
        height={size}
        style={{
          position: "absolute",
          inset: 0,
          width: size,
          height: size,
          objectFit: "contain",
          opacity: active ? 1 : 0,
          transition: "opacity 320ms ease",
          filter: active ? "drop-shadow(0 0 6px rgba(224,138,46,0.55))" : "none",
        }}
        className={active ? "mimir-glow" : undefined}
      />
    </span>
  );
}
