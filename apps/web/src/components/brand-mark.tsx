/** The Truepost TP mark, with a brightened variant so it keeps its contrast on the dark theme. */
export function BrandMark({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  const alt = decorative ? "" : "Truepost";
  return (
    <span className={`inline-block ${className}`}>
      <img src="/icons/brand-mark-192.png" alt={alt} className="h-full w-full object-contain dark:hidden" />
      <img src="/icons/brand-mark-dark-192.png" alt={alt} className="hidden h-full w-full object-contain drop-shadow-[0_0_10px_rgba(76,148,253,0.55)] dark:block" />
    </span>
  );
}
