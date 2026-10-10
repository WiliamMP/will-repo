import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// email -> image URL, shared by every row (hashing once per author, not per commit)
const cache = new Map<string, Promise<string>>();

/** GitHub's noreply emails point to the account; anything else goes to Gravatar */
function avatarUrl(email: string): Promise<string> {
  const key = email.trim().toLowerCase();
  let url = cache.get(key);
  if (!url) {
    // 12345+login@users.noreply.github.com  or  login@users.noreply.github.com
    const gh = key.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
    url = gh
      ? Promise.resolve(gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=40` : `https://github.com/${gh[2]}.png?size=40`)
      : // Gravatar identifies the account by the SHA-256 of the email (the email itself is not sent)
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)).then((buf) => {
          const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
          return `https://gravatar.com/avatar/${hex}?s=40&d=404`;
        });
    cache.set(key, url);
  }
  return url;
}

// emails whose image failed once: show initials right away next time
const failed = new Set<string>();

/** Small round photo of a commit author, initials when there is none */
export function AuthorAvatar({ name, email, className }: { name: string; email: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(failed.has(email));

  useEffect(() => {
    let stale = false;
    setBroken(failed.has(email));
    if (email) avatarUrl(email).then((u) => !stale && setUrl(u));
    return () => {
      stale = true;
    };
  }, [email]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/20 text-[8px] font-semibold text-primary",
        className,
      )}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => {
            failed.add(email);
            setBroken(true);
          }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
