export interface SkeletonListProps {
  readonly label: string;
  readonly rows?: number;
}

/** Layout-preserving loading state for short lists. */
export function SkeletonList({ label, rows = 3 }: SkeletonListProps) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="mb-6">
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true" className="flex list-none flex-col gap-2 p-0">
        {Array.from({ length: rows }, (_, index) => (
          <li
            // The placeholder is fixed, so its position is the stable identity.
            key={index}
            className="flex min-h-touch-min animate-pulse items-center justify-between gap-3 rounded border border-soil-200 bg-sand-50 p-3 motion-reduce:animate-none"
          >
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-4 w-2/5 rounded bg-soil-200" />
              <span className="h-3 w-3/5 rounded bg-sand-200" />
            </span>
            <span className="h-8 w-20 rounded bg-sand-200" />
          </li>
        ))}
      </ul>
    </div>
  );
}
