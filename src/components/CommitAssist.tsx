import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Conventional Commits types offered as chips
const TYPES = ["feat", "fix", "docs", "refactor", "style", "test", "perf", "chore"];

// "type(scope)!: " at the start of the title
const PREFIX = /^(\w+)(\([^)]*\))?(!)?: /;

/** Sets the type of the title, keeping scope, "!" and the rest of the message */
export function withType(message: string, type: string) {
  const m = message.match(PREFIX);
  if (!m) return `${type}: ${message}`;
  // same chip again removes the prefix
  if (m[1] === type) return message.slice(m[0].length);
  return `${type}${m[2] ?? ""}${m[3] ?? ""}: ${message.slice(m[0].length)}`;
}

type Props = {
  message: string;
  onChange: (message: string) => void;
  /** recent commit subjects, newest first */
  recent: string[];
  disabled?: boolean;
};

// Row above the commit box: type chips, recent messages and the title length
export function CommitAssist({ message, onChange, recent, disabled }: Props) {
  const [showRecent, setShowRecent] = useState(false);
  const type = message.match(PREFIX)?.[1];
  const title = message.split("\n")[0].length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {TYPES.map((t) => (
          <Button
            key={t}
            variant={t === type ? "default" : "outline"}
            size="xs"
            className="h-5 px-1.5 font-mono text-[11px]"
            disabled={disabled}
            onClick={() => onChange(withType(message, t))}
          >
            {t}
          </Button>
        ))}
        {recent.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="h-5 px-1.5 text-[11px] text-muted-foreground"
            disabled={disabled}
            onClick={() => setShowRecent((v) => !v)}
          >
            Recentes <ChevronDown className={cn("transition-transform", showRecent && "rotate-180")} />
          </Button>
        )}
        <span
          title="Título: até 50 caracteres é o ideal, 72 é o limite"
          className={cn(
            "ml-auto font-mono text-[11px] text-muted-foreground tabular-nums",
            title > 50 && "text-warning",
            title > 72 && "text-destructive",
          )}
        >
          {title}/72
        </span>
      </div>
      {showRecent && (
        <div className="flex max-h-32 flex-col overflow-auto rounded-md border bg-background py-1">
          {recent.map((s) => (
            <button
              key={s}
              className="truncate px-2 py-0.5 text-left text-xs hover:bg-muted"
              title={s}
              onClick={() => {
                onChange(s);
                setShowRecent(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
