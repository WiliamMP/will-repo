// Animation kit of the app (motion library), so every screen moves the same way:
// short (150-250 ms), springy, and off when the user asks (Settings or Windows).
import { useEffect, type ReactNode } from "react";
import { MotionConfig, motion, type HTMLMotionProps, type Transition } from "motion/react";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

/** default feel: quick spring that settles without bouncing much */
export const spring: Transition = { type: "spring", stiffness: 520, damping: 40, mass: 0.6 };
export const quick: Transition = { duration: 0.16, ease: [0.2, 0, 0, 1] };

/**
 * Applies Settings > Aparência > Animações to every motion component, and to the CSS
 * animations (dialogs, toasts) through html[data-motion]. "full" still follows
 * Windows' "Animation effects" switch (reducedMotion="user").
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { animations } = useSettings();
  useEffect(() => {
    document.documentElement.dataset.motion = animations;
  }, [animations]);
  return (
    <MotionConfig
      reducedMotion={animations === "full" ? "user" : "always"}
      transition={animations === "off" ? { duration: 0 } : spring}
    >
      {children}
    </MotionConfig>
  );
}

/**
 * The highlight behind the active tab; with the same `group` on every tab of a list it
 * slides to the newly selected one (shared layout animation).
 */
export function TabPill({ group, className }: { group: string; className?: string }) {
  return (
    <motion.span
      layoutId={`pill:${group}`}
      className={cn("absolute inset-0 -z-10 rounded-md border bg-background shadow-sm dark:border-input dark:bg-input/30", className)}
    />
  );
}

/** Content that eases in when it appears (tab panels, settings pages) */
export function FadeIn({ className, ...props }: HTMLMotionProps<"div">) {
  return <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={quick} className={className} {...props} />;
}

/** Staggered entrance for short lists (palette items, dashboard cards); capped so long lists don't drag */
export const enter = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { ...quick, delay: Math.min(i, 10) * 0.025 },
});
