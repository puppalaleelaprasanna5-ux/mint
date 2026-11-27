import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonStyles, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <SearchX className="size-6 text-subtle" aria-hidden />
        <h1 className="text-base font-semibold">Not found</h1>
        <p className="text-sm text-muted">That page or instrument does not exist in Mint&apos;s database.</p>
        <Link href="/explore" className={buttonStyles.secondary}>
          Search stocks
        </Link>
      </div>
    </Card>
  );
}
