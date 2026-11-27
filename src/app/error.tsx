"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { buttonStyles, Card } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg">
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <AlertTriangle className="size-6 text-down" aria-hidden />
        <h1 className="text-base font-semibold">This page could not load</h1>
        <p className="text-sm text-muted">
          Mint hit an unexpected error. If this keeps happening, check that the database exists
          (<code className="text-fg">npm run db:setup</code>) and look at the server log.
        </p>
        <button type="button" onClick={() => retry()} className={buttonStyles.secondary}>
          <RotateCcw className="size-4" /> Try again
        </button>
      </div>
    </Card>
  );
}
