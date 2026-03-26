import { formatPremiumMultiplierLabel } from "@/lib/format";

interface ModelOptionLabelProps {
  name: string;
  premiumMultiplier?: number;
}

export function ModelOptionLabel({ name, premiumMultiplier }: ModelOptionLabelProps) {
  const multiplierLabel = formatPremiumMultiplierLabel(premiumMultiplier);

  return (
    <span className="flex items-center gap-2">
      <span>{name}</span>
      {multiplierLabel && (
        <span className="rounded-full border border-border-muted px-2 py-0.5 text-[11px] leading-none text-muted-foreground">
          {multiplierLabel}
        </span>
      )}
    </span>
  );
}
