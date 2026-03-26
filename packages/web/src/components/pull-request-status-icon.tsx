import { cn } from "@/lib/utils";
import { GitPrIcon } from "@/components/ui/icons";

export type PullRequestStatus = "open" | "merged" | "closed" | "draft";

function pullRequestStatusIconClassName(status: PullRequestStatus) {
  switch (status) {
    case "merged":
      return "text-[#8250df]";
    case "closed":
      return "text-[#cf222e]";
    case "draft":
      return "text-muted-foreground";
    case "open":
    default:
      return "text-success";
  }
}

interface PullRequestStatusIconProps {
  status: PullRequestStatus;
  className?: string;
}

export function PullRequestStatusIcon({ status, className }: PullRequestStatusIconProps) {
  return (
    <span
      aria-label={`PR ${status}`}
      title={`PR ${status}`}
      className={cn("inline-flex items-center", pullRequestStatusIconClassName(status))}
    >
      <GitPrIcon className={cn("shrink-0", className)} />
    </span>
  );
}
