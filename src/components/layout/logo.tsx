import Link from "next/link";
import { Leaf } from "lucide-react";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg">
      <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent-strong">
        <Leaf className="size-4" aria-hidden />
      </span>
      <span className="text-[15px]">Mint</span>
    </Link>
  );
}
