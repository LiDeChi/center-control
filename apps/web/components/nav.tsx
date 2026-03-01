"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [{ href: "/projects", label: "项目控制台" }];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="main-nav" aria-label="主导航">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
