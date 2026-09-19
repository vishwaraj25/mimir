"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className="rail-link" data-active={active}>
      <span className="ic">{icon}</span>
      {label}
    </Link>
  );
}
