"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLink({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className="rail-link" data-active={active}>
      <span className="dot" />
      {label}
    </Link>
  );
}
