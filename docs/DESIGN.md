---
name: Mayu
product: ILLAPA (dash.illapa.app, illapa.app)
base: shadcn/ui on Base UI (style base-lyra components, restyled)
preset: b4DfkM0rNw # approximation on ui.shadcn.com/create; this file is the source of truth
modes: [light, dark] # both first-class; light is the default everywhere, a switch selects dark
colors:
  light:
    background: "#F2F7F8"
    foreground: "#0A2530"
    card: "#FFFFFF"
    popover: "#FFFFFF"
    muted: "#E4EFF1"
    muted-foreground: "#4D6B74"
    secondary: "#E4EFF1"
    accent: "#D5E8EC"
    primary: "#0B6E78"
    primary-foreground: "#FFFFFF"
    border: "#0A253021"
    input: "#0A253029"
    ring: "#0B6E78"
    destructive: "#C92A22"
    destructive-foreground: "#FFFFFF"
    brand-river: "#0B6E78"
    brand-starlight: "#8A6A1F"
    info: "#2459C9"
    info-foreground: "#FFFFFF"
    risk-low: { fill: "#3E7D18", ink: "#FFFFFF" }
    risk-moderate: { fill: "#E8BC00", ink: "#0A090B" }
    risk-high: { fill: "#D96200", ink: "#0A090B" }
    risk-critical: { fill: "#C92A22", ink: "#FFFFFF" }
    chart: ["#0B6E78", "#2459C9", "#6D4FD8", "#557782", "#8A6A1F"]
  dark:
    background: "#06181F"
    foreground: "#E4F3F4"
    card: "#0B252F"
    popover: "#10303C"
    muted: "#10303C"
    muted-foreground: "#8EB2BA"
    secondary: "#10303C"
    accent: "#15394A"
    primary: "#34C6C2"
    primary-foreground: "#04161B"
    border: "#E4F3F41F"
    input: "#E4F3F42E"
    ring: "#6FE0DC"
    destructive: "#FF5148"
    destructive-foreground: "#06181F"
    brand-river: "#34C6C2"
    brand-starlight: "#F3E7C9"
    info: "#6B9BFF"
    info-foreground: "#06181F"
    risk-low: { fill: "#8FD45A", ink: "#06181F" }
    risk-moderate: { fill: "#F4D03F", ink: "#06181F" }
    risk-high: { fill: "#FF8A2A", ink: "#06181F" }
    risk-critical: { fill: "#FF5148", ink: "#06181F" }
    chart: ["#34C6C2", "#6B9BFF", "#A78BFA", "#7FA6B0", "#F3E7C9"]
typography:
  display: { family: "Archivo Variable", weight: 800, stretch: 125%, size: "clamp(40px, 5vw + 12px, 68px)", line-height: 1, tracking: "0.005em", case: uppercase, utility: type-display }
  title: { family: "Archivo Variable", weight: 800, stretch: 125%, size: "clamp(28px, 2.6vw + 12px, 44px)", line-height: 1.05, tracking: "0.005em", case: uppercase, utility: type-title }
  heading: { family: "Archivo Variable", weight: 800, stretch: 125%, size: 17px, line-height: 1.2, tracking: "0.005em", case: uppercase, utility: type-heading }
  lead: { family: "Archivo Variable", weight: 400, size: "clamp(17px, 0.5vw + 14px, 20px)", line-height: 1.6, utility: type-lead }
  body: { family: "Archivo Variable", weight: 400, size: 15px, line-height: 1.6, utility: type-body }
  label: { family: "JetBrains Mono Variable", weight: 600, size: 11px, line-height: 1.4, tracking: "0.1em", case: uppercase, utility: type-label }
  data: { family: "JetBrains Mono Variable", weight: 500, size: 13px, line-height: 1.45, numerals: tabular, utility: type-data }
  button: { family: "Archivo Variable", weight: 600, size: 12px, tracking: "0.06em", case: uppercase }
rounded:
  base: 14px
  xs: 4px
  sm: 6px # inner items: menu, command and select items, calendar days, checkbox
  md: 10px # controls: button, input, select trigger, toggle, tabs, badge, tooltip, kbd
  lg: 14px # surfaces: card, alert, popovers and menus, dialog, toast, map popups
  xl: 18px
  2xl: 22px
  3xl: 26px
  full: 9999px # switch, radio, avatar, slider thumb, progress, status dots and map markers
elevation: none # layers separate with hairline borders; overlays add a visible scrim
spacing: tailwind default 4px scale; section rhythm py-16 to py-24, card padding 16px (12px small)
---

# ILLAPA design system: Mayu

## Overview

Illapa is the Andean god of thunder, lightning and rain. In the stories he fills his jug from **Mayu**, the river of stars we call the Milky Way, and breaks it with his sling to make the rain. Rain is also the hazard ILLAPA reports most: lluvias, huaicos, deslizamientos.

Mayu turns that into a calm interface: misty river-light by day and deep river-night after dark, an aqua current as the one brand colour, starlight for warmth, and soft rounded geometry. The product has to stay calm when a road is closing; the risk colours carry the urgency, the brand never does.

The same system serves the dashboard (`apps/web`, dash.illapa.app), the marketing site (`apps/illapa`, illapa.app) and the native app later. The pitch deck does **not** use Mayu: it keeps the Hack the Andes black with the phoenix colours of Equipo Fénix.

Live reference: `/design-system` in the web app (`pnpm dev:web`, http://localhost:3001/design-system), in Spanish and English, dark and light.

## Logo

The mark is **Gota de rayo**: an aqua raindrop carrying a starlight lightning bolt, Illapa's rain and lightning in one shape and the two things the product watches.

- Component: `IllapaMark` (mark) and `IllapaLockup` (mark + wordmark) in `packages/ui/src/components/illapa-logo.tsx`. The drop uses `brand-river` and the bolt `brand-starlight`, so the logo follows light and dark on its own.
- Wordmark: "illapa" in lowercase, Archivo Expanded 800 (`font-stretch` 125%), tracking -0.01em.
- App icon and favicon: the mark on the night tile (`#0B252F` to `#06181F`), so it reads in light and dark browser tabs. Files in each app's `public/`: `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` (180 px, square; iOS rounds it).
- Clear space: the width of the bolt on every side. Minimum size: 16 px for the mark or icon, 96 px wide for the lockup.
- Colour: brand-river with brand-starlight, or a single solid colour (`foreground`) where only one ink is available. Never in risk colours, never a gradient on the drop.
- Never stretch, rotate, outline or redraw the mark, and never place it on photos or maps without a surface behind it.

## Colors

All colours are CSS variables in `packages/ui/src/styles/globals.css`, light values in `:root` and dark values in `.dark`, registered with Tailwind in `@theme inline` (`bg-primary`, `text-risk-high-foreground`, `stroke-brand-river`, …). Never use a raw hex or a Tailwind palette class (`bg-red-500`) in a component.

| Role | Tokens | Use |
| --- | --- | --- |
| Surfaces | `background`, `card`, `popover`, `muted`, `secondary`, `accent` | Canvas, raised panels, floating layers, quiet fills, hover wash. |
| Ink | `foreground`, `muted-foreground` | Text and icons. Muted is for secondary text, never for anything the user must read to act. |
| Action | `primary`, `primary-foreground`, `ring` | One primary action per group; focus rings. |
| Brand | `brand-river` (Mayu, aqua), `brand-starlight` (Estrella) | Identity only: wordmark, hero, art, illustrations. |
| Risk | `risk-low`, `risk-moderate`, `risk-high`, `risk-critical` (+ `-foreground`) | Risk levels only. See "Risk and data". |
| Status | `info`, `success` (= `risk-low`), `destructive` (= `risk-critical` values) | System states such as saved, failed, informational. |
| Data | `chart-1` … `chart-5` | Non-risk series: rainfall, counts, vehicles, comparisons. |
| Lines | `border`, `input` | Hairlines between layers and around fields. |

Contrast: every text pair passes WCAG AA (4.5:1) in both modes; the `/design-system` page measures them live. The light-mode yellow (`risk-moderate`) is only 1.7:1 against the canvas, so on maps and charts it always gets a dark outline or sits on a card.

## Typography

| Role | Utility | Face | Where |
| --- | --- | --- | --- |
The type comes from the Rayo direction the team kept alongside Mayu's colours, radius and art: Archivo Expanded for headlines, Archivo for reading, JetBrains Mono for labels and data.

| Role | Utility | Face | Where |
| --- | --- | --- | --- |
| Display | `type-display` | Archivo Expanded 800, uppercase | Hero headlines, one per page. |
| Title | `type-title` | Archivo Expanded 800, uppercase | Section and page titles. |
| Heading | `type-heading` | Archivo Expanded 800, uppercase | Card, panel, dialog and sheet titles. |
| Lead | `type-lead` | Archivo 400 | Marketing intros and short summaries under a title. |
| Body | `type-body` | Archivo 400 | Running text and descriptions. |
| Label | `type-label` | JetBrains Mono 600, uppercase | Kickers, badges, table heads, small metadata. |
| Data | `type-data` | JetBrains Mono 500, tabular | Kilometres, times, counts, coordinates, horizons. |

- Fonts come from Fontsource (`@fontsource-variable/archivo` `wdth.css` for the width axis, `@fontsource-variable/jetbrains-mono`), imported once in `globals.css`. `--font-sans` and `--font-heading` are Archivo, `--font-mono` JetBrains Mono. Headlines get the expanded cut through `font-stretch: 125%` (`font-stretch-expanded` in Tailwind).
- Headlines, labels and buttons are uppercase; write them in sentence case in the source and let the utility transform them. Running text stays sentence case.
- Use the utilities instead of hand-rolled sizes (`text-3xl font-bold`). Avoid `text-*` theme keys for type roles; `cn()` treats them as colours.
- Buttons use Archivo 600 at 12px, uppercase with 0.06em tracking (the `link` variant stays in running-text case). Form labels use `text-sm font-medium`.
- Type sizes are in rem; the px values in the frontmatter are the M size at a 16px root. The account menu's Tamaño de texto (S, M, L) sets the root to 87.5%, 100% or 112.5% through `data-font-size` on `<html>`, saved per device under `illapa-font-size` and applied by an inline head script before first paint, so type and the rem-based spacing scale together. Never size type in px.

## Layout and spacing

- Tailwind's 4px spacing scale; group siblings with `gap`, not margins.
- Pages: `max-w-7xl` container, `px-5 sm:px-8`, sections `py-16 md:py-24`, hairline separators between sections.
- Dashboard: dense but breathable; cards pad 16px (12px for `size="sm"`), tables use `type-data` cells and `type-label` heads.
- Everything must work at 375px with no horizontal page scroll; wide tables and matrices scroll inside their own container.

### Theme

- Light is the default for everyone, in the app and on illapa.app. In the dashboard the account menu's Tema control offers Claro, Oscuro and Sistema as a segmented `ToggleGroup`; the login page and illapa.app keep the theme switch (`ThemeSwitch`: sun, switch, moon). Never a dropdown.
- The choice persists per device under the `illapa-theme` key; the marketing site applies it in an inline head script so the page never flashes.

### Navigation shell

The dashboard uses one collapsible rail built on the shadcn `Sidebar` with `collapsible="icon"` (`DashboardSidebar`):

- Expanded on desktop (1280px and up), collapsed to an icon rail on tablets (768 to 1279px), a drawer on phones. Only an explicit choice is saved (`useSidebarPreference`, key `illapa-sidebar`).
- Toggle with the button in the rail head, the rail edge, `[` or Ctrl/Cmd+B. Collapsed items keep their icon and show their label in a tooltip; badges become a dot.
- The rail holds everything global: brand, navigation and the account at the bottom. The page header keeps only the page title (and the drawer button on phones).
- The account menu (`AccountMenu`) is a `Popover` above the avatar, or to its right when collapsed. It holds the identity, then Preferencias as segmented `ToggleGroup`s (Tema: Claro, Oscuro, Sistema; Idioma: 🇵🇪 ES, 🇺🇸 EN, flags from `country-flag-icons`; Tamaño de texto: S, M, L), then Cerrar sesión, which stays open with a retry message if signing out fails.

## Shapes

Radius is pinned in `@theme inline`, not derived:

| Class | Value | Role |
| --- | --- | --- |
| `rounded-xs` | 4px | Tiny accents. |
| `rounded-sm` | 6px | Inner items: menu, command and select items, calendar days, checkbox. |
| `rounded-md` | 10px | Controls: button, input, input group, textarea, select and combobox triggers, toggle, tabs, badge, kbd, tooltip. |
| `rounded-lg` | 14px | Surfaces: card, alert, popovers and menus, dialog, alert dialog, toast, item, empty state, code block, map popups and controls. |
| `rounded-xl` … `rounded-3xl` | 18 / 22 / 26px | Large containers and marketing bands. |
| `rounded-full` | pill | Switch, radio, avatar, slider thumb, progress, status dots, map markers. |

## Elevation

No drop shadows. Layers separate with a 1px `border` hairline; floating layers (menus, popovers, tooltips, dialogs) always have one. Modal overlays use a token scrim (`bg-background/70` with a light backdrop blur) so they read in both modes.

## Components

All components live in `packages/ui/src/components` (shadcn/ui on Base UI; use the `render` prop, not `asChild`). Variants that matter for ILLAPA:

- **Button:** `default` (primary aqua), `secondary`, `outline`, `ghost`, `link`, `destructive` (solid). One `default` per group.
- **Badge:** plus `low`, `moderate`, `high`, `critical`, `info`, `success`, solid fills with their `-foreground` ink. Use these for every risk label.
- **Alert:** plus `low`, `moderate`, `high`, `critical`, `info`, `success`: card surface, a left border in the status colour, icon in the status colour, title in the foreground colour.
- **Toasts (Sonner):** rich colours mapped to `success`, `info`, `risk-moderate` (warning) and `risk-critical` (error).
- **Severity (incidents):** the three incident severities map onto the risk scale: `critical` → `risk-critical`, `warning` → `risk-high`, `info` → `info`.
- **Art:** `StarRiver` and `RainStreaks` (`mayu-art.tsx`) for identity moments; `TopoBackground` (`contour-art.tsx`) as a faint terrain texture behind data panels.
- **Showcase helpers** (`components/showcase/*`) exist for the `/design-system` page only.

Adding a component: `npx shadcn@latest add <name>` inside `packages/ui`, then restyle it with this file: radius by role, hairline instead of shadow, full-strength `ring-ring` focus, `type-*` utilities for titles and labels. Show it on `/design-system` in the right tier.

## Risk and data

ILLAPA's core output is a risk level per road segment, so the risk scale is protected:

- Four levels that follow SENAMHI's warning colours: **Bajo** (verde), **Moderado** (amarillo), **Alto** (naranja), **Crítico** (rojo). Recommendations pair with them: Continuar, Monitorear, Retrasar, Desviar.
- A risk colour is always paired with a text label (badge, legend, tooltip). Never colour alone.
- Risk colours are fills with their own ink. Do not set risk colours as text on the canvas.
- `risk-low` is a leaf green on purpose, shifted away from the aqua brand so "bajo" never reads as "brand".
- Non-risk data uses `chart-*`; brand colours never encode data.

## Maps

- Basemaps follow the theme: CARTO dark-matter in dark mode, positron in light mode (`map.tsx` and `map-view.tsx`).
- MapLibre cannot read CSS variables. Resolve token colours with `useTokenColors` (`packages/ui/src/hooks/use-token-colors.ts`), which updates when the theme changes.
- Incident points and route segments use the risk tokens; warning areas use a subtle fill (about 8%) with a solid outline in the severity colour.

## Art and imagery

- **StarRiver:** a diagonal band of stars in `brand-starlight` over a soft `brand-river` glow. Hero areas, the login panel, the marketing call to action.
- **RainStreaks:** short diagonal strokes in `currentColor` at low opacity, layered over StarRiver or a card.
- **TopoBackground:** faint terrain contours behind maps and data panels.
- Use art in identity moments, at most one composition per screen, never behind dense data.

## Voice and language

- Spanish (Peru) first, English second, through Paraglide (`apps/web/messages/{es,en}.json`). Shared domain keys are un-prefixed (`risk_*`, `recommendation_*`, `horizon_*`).
- Write what the planner does next: "Desviar por la PE-3S antes de las 14:00", not "Alerta de evento".
- Name sources and times: "SUTRAN · 06:40", "aviso SENAMHI naranja".

## Accessibility

- Text contrast AA in both modes; the ring token gives a full-strength, visible focus on every control.
- Every risk state has text; every icon-only button has an accessible name.
- Respect `prefers-reduced-motion` for marker pulses and art.

## Do and don't

| Do | Don't |
| --- | --- |
| Label every risk colour with its level. | Show a coloured dot with no text. |
| Use `brand-river` for the wordmark, hero and art. | Use the aqua brand to mean "safe" or "bajo". |
| Keep one primary button per group. | Put two aqua buttons side by side. |
| Use `type-*` utilities and token classes. | Hand-roll sizes or use raw hex and palette classes. |
| Separate layers with hairlines. | Add drop shadows or glows to cards. |
| Use the chart palette for non-risk series. | Plot rainfall in risk orange. |

## Known gaps

- The preset `b4DfkM0rNw` on ui.shadcn.com/create only approximates Mayu (rhea geometry, and its fonts differ from the Rayo type above); use it to preview, not to install.
- Franz's dashboard screens are still hard-coded in Spanish (about 230 strings); they need Paraglide keys before the English toggle covers them.
- The native app (`apps/native`) does not use these tokens yet.
