import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ToolbarButtonProps = {
  icon: LucideIcon;
  label: string;
  keys: string[];
  onClick: () => void;
  busy?: string | null;
  id?: string;
};

export function ToolbarButton({ icon: Icon, label, keys, onClick, busy, id }: ToolbarButtonProps) {
  const spinning = !!id && busy === id;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!!busy} onClick={onClick}>
          {spinning ? <Loader2 className="animate-spin" /> : <Icon />} {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
