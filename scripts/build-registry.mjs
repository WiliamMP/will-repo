// Builds the "Neon" shadcn registry from this app's own theme and components,
// so other apps get the same look with:  npx shadcn add <registry url>/neon.json
// The theme is read from src/index.css (single source of truth), then `shadcn build`
// writes one JSON per item to registry-dist/.
//
// Usage: node scripts/build-registry.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

/** "--name: value;" pairs of one CSS block (`:root {` or `.dark {`) */
function vars(selector) {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = vars(":root");
const dark = vars(".dark");
// tokens the app adds on top of shadcn's (success, warning, diff colors, graph lanes, glow)
const extra = Object.keys(light).filter((k) => /^(success|warning|diff-|lane-|glow)/.test(k));

const ui = (name, title, description, deps = []) => ({
  name: `neon-${name}`,
  type: "registry:ui",
  title,
  description,
  dependencies: deps,
  files: [{ path: `src/components/ui/${name}.tsx`, type: "registry:ui" }],
});

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: "neon",
  homepage: "https://github.com/WiliamMP/will-repo",
  items: [
    {
      name: "neon-theme",
      type: "registry:theme",
      title: "Neon",
      description: "Tema Neon do will-repo: roxo neon, claro e escuro, cores extras (sucesso, aviso, diff, lanes) e brilho.",
      cssVars: {
        theme: {
          "font-sans": "'Geist Variable', 'Segoe UI Variable', sans-serif",
          "font-mono": "'Geist Mono Variable', 'Cascadia Code', monospace",
          ...Object.fromEntries(extra.map((k) => [`color-${k}`, `var(--${k})`])),
        },
        light,
        dark,
      },
      // the app's fonts
      dependencies: ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"],
    },
    ui("border-beam", "Border Beam", "Feixe de luz animado percorrendo a borda (Magic UI).", ["motion"]),
    ui("shimmer-button", "Shimmer Button", "Botão com brilho girando na borda (Magic UI)."),
    ui("animated-shiny-text", "Animated Shiny Text", "Texto com reflexo passando (Magic UI)."),
    ui("dot-pattern", "Dot Pattern", "Fundo de pontos para estados vazios (Magic UI)."),
    {
      name: "neon",
      type: "registry:block",
      title: "Neon (tudo)",
      description: "Tema Neon e os componentes animados de uma vez.",
      registryDependencies: ["neon-theme", "neon-border-beam", "neon-shimmer-button", "neon-animated-shiny-text", "neon-dot-pattern"].map(
        // relative to where the registry is hosted (REGISTRY_URL)
        (n) => `${process.env.REGISTRY_URL ?? "{{url}}"}/${n}.json`,
      ),
      files: [],
    },
  ],
};

writeFileSync("registry.json", JSON.stringify(registry, null, 2) + "\n");
console.log(`registry.json: ${registry.items.length} itens, ${Object.keys(light).length} variáveis claras, ${Object.keys(dark).length} escuras`);
execSync("npx shadcn build registry.json --output registry-dist", { stdio: "inherit" });
