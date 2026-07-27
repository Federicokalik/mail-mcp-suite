# email-html-mjml — Production-Ready Email Templates for Claude Code

**A Claude Code skill that generates responsive, cross-client HTML email from a single conversation.**

Describe your email. Get back valid MJML source and compiled, production-ready HTML — guaranteed to render in Outlook 2013–365, Gmail (web and app), and Apple Mail without manual table coding, VML hand-authoring, or email client guesswork.

---

## The Problem: Email Rendering Is Broken by Design

Every major email client uses a different rendering engine:

- **Outlook 2007–2021** renders HTML with **Microsoft Word** — not a browser
- **Gmail** strips `<head>` CSS and clips messages over **102KB**
- **iOS Mail** and Android stack multi-column layouts when whitespace exists between `inline-block` elements
- **Apple Mail** applies forced dark-mode inversion on light backgrounds

The result: an email that looks correct in a browser can break catastrophically in production. Fixing it requires deep knowledge of **VML injection**, **Ghost Tables**, **CSS inlining**, and client-specific quirks that are rarely documented in one place.

---

## The Solution: MJML as a Reliability Framework

This skill uses **MJML 4.x** — not as a convenience layer, but as a **structural reliability framework**. MJML compiles semantic XML into the deeply nested, client-specific table HTML that email clients actually need. The output includes:

- **Ghost Tables** (MSO conditional comments) that constrain layout for Outlook's Word engine while remaining invisible to modern clients
- **Automatic VML injection** for background images in `<mj-section>` and `<mj-hero>`, the only two components where Outlook supports them
- **Hybrid-Fluid column math** — fluid percentage widths for modern clients, fixed Ghost Table widths for Outlook — generated from the same source

Writing this HTML by hand is error-prone and nearly impossible to maintain. MJML makes the correct output the default output.

---

## What This Skill Delivers

### Gmail Clip Prevention

Every template is compiled with `--config.minify=true`, which removes whitespace between `inline-block` elements. This serves two purposes: it keeps compiled HTML **under Gmail's 102KB clip threshold**, and it eliminates the iOS/Android **column stacking bug** caused by whitespace between columns — even inside `<mj-group>`.

### Outlook Stability

- **Automatic VML** for background images (section and hero only — the only locations where Outlook generates VML)
- **Font fallback protection** via `<mj-font>`, which wraps `@font-face` imports in MSO conditional comments so Outlook ignores them and uses the system fallback stack instead of Times New Roman
- **Background positioning** restricted to keyword values (`top`, `center`, `bottom`) — pixel values are silently ignored by Outlook

### Zero-Stacking Guarantee

Multi-column layouts that must stay side-by-side on mobile (social bars, logo rows, icon grids) use `<mj-group>` to prevent stacking. Combined with minification, this eliminates the whitespace-triggered stacking bug across iOS Mail and Android Gmail.

### Head-First Optimization

The `<mj-head>` block is the control center for every template:

- **`<mj-attributes>`** sets global defaults (`<mj-all>`) and named classes (`<mj-class>`) that eliminate repetitive inline styles across sections
- **`<mj-style inline="inline">`** forces Juice CSS inlining for Gmail compatibility — critical layout styles never rely on `<head>` CSS alone
- **`<mj-font>`** imports web fonts with automatic Outlook exclusion
- **`<mj-preview>`** populates inbox preview text

### Dark Mode Resilience

When dark mode support is required, the skill implements the full pattern: `<meta name="color-scheme" content="light dark">` via `<mj-raw>`, logo swapping via `inline="inline"` style hiding, and `@media (prefers-color-scheme: dark)` overrides in non-inlined `<mj-style>`. Safe neutrals `#121212` and `#F1F1F1` replace pure black and white to prevent jarring forced inversions in Apple Mail.

### Accessibility (WCAG 2.1 AA)

- Every `<mj-image>` requires `alt` text — enforced at generation time
- `<mj-title>` populates both `<title>` and the `aria-label` on the MJML-generated body wrapper `<div role="article">`
- `lang` on the root `<mjml>` tag flows through to the `<html>` element and body wrapper
- **Heading ARIA roles** are applied via `<mj-html-attributes>` + `css-class` targeting — direct `role` attributes on `<mj-text>` are invalid under strict validation and are never used

### Templating Engine Support

Dynamic template tags (`{{handlebars}}`, `{% liquid %}`, `{{ jinja }}`) are wrapped in `<mj-raw>` to protect them from the MJML parser. The compiled HTML preserves the tags intact for injection by your ESP (SendGrid, AWS SES, Postmark, etc.).

---

## The Workflow

```
User request
     │
     ▼
1. Gather requirements
   Infer email type, brand colors, and layout from context.
   Ask only for what is genuinely missing.
     │
     ▼
2. Plan layout
   Announce structure before writing code:
   single-column / 2-col grid / hero+content / etc.
     │
     ▼
3. Load component references
   Read only the component files needed for this template.
     │
     ▼
4. Generate MJML
   Complete <mjml> document with full <mj-head>:
   mj-attributes, mj-font, mj-title, mj-preview, mj-style
     │
     ▼
5. Compile
   npx mjml template.mjml -o dist/template.html \
     --config.minify=true \
     --config.validationLevel=strict
     │
     ▼
6. Deliver both files
   ├── template.mjml  (editable source, version-controllable)
   └── dist/template.html  (production HTML, send via ESP)
```

**Output files are always delivered as a pair.** The `.mjml` source is the editable artifact — version-controlled, templating-engine-friendly, safe to modify. The `.html` is the compiled production artifact — minified, table-based, ready to paste into any ESP.

---

## Technical Architecture

### Hybrid-Fluid Design ("Spongy" Layout)

MJML uses a **hybrid** rendering strategy sometimes called "spongy" layout:

- **Modern clients** (Apple Mail, Gmail app, Outlook 365 on Mac): receive fluid percentage widths that respond to the viewport
- **Outlook on Windows** (2013–2021): receives fixed-width Ghost Tables inside MSO conditional comments that constrain the layout to 600px regardless of window size

Both are generated from the same MJML source. The developer writes `<mj-section>` and `<mj-column>` — MJML emits the correct structure for each target.

### Column Width Math

Column widths are auto-calculated from the default 600px body width:

| Columns | Auto width |
|---------|-----------|
| 1 | 600px (100%) |
| 2 | 300px each (50%) |
| 3 | 200px each (33.33%) |

Override with explicit `width` on `<mj-column>`. Values must sum to 600px or 100%.

### Document Hierarchy

```
<mjml lang="en">
└── <mj-head>
│   ├── <mj-title>
│   ├── <mj-preview>
│   ├── <mj-font>
│   ├── <mj-attributes>
│   ├── <mj-style inline="inline">   ← Gmail-safe
│   ├── <mj-style>                   ← Dark mode / media queries
│   ├── <mj-html-attributes>         ← ARIA roles
│   └── <mj-raw>                     ← Meta tags, template guards
└── <mj-body>
    ├── <mj-wrapper>                 ← Optional: shared border/bg across sections
    │   └── <mj-section>
    ├── <mj-section>                 ← Row (background, padding, border)
    │   ├── <mj-column>              ← Column (width, vertical-align)
    │   │   ├── <mj-text>
    │   │   ├── <mj-image>
    │   │   ├── <mj-button>
    │   │   ├── <mj-divider>
    │   │   ├── <mj-spacer>
    │   │   └── <mj-table>
    │   └── <mj-group>               ← Prevents mobile stacking
    │       └── <mj-column>
    ├── <mj-hero>                    ← Full-bleed hero with VML background
    └── <mj-section>
        └── <mj-column>
            └── <mj-social>
                └── <mj-social-element>
```

Hard constraint: `<mj-section>` cannot be nested inside another `<mj-column>`. All visual content must follow the Section → Column → Content hierarchy.

---

## Engineering Rules

| # | Rule | Why It Matters |
|---|------|---------------|
| 1 | All content inside `<mj-column>` inside `<mj-section>` | MJML validation fails otherwise |
| 2 | `<mj-group>` for side-by-side elements on mobile | Prevents iOS/Android column stacking |
| 3 | `<mj-font>` + fallback stack for all web fonts | Blocks Outlook's Times New Roman fallback |
| 4 | `inline="inline"` on `<mj-style>` for critical CSS | Gmail strips `<head>` styles |
| 5 | Always compile with `--config.minify=true` | Fixes stacking bug; stays under 102KB Gmail clip |
| 6 | `alt` on every image; `<mj-title>` always set | WCAG 2.1 AA; screen reader compatibility |
| 7 | `<mj-attributes>` for global defaults | Eliminates repetitive inline styles |
| 8 | `<mj-hero>` for full-bleed backgrounds | VML generated automatically for Outlook |
| 9 | `<mj-raw>` for template engine tags | Protects Handlebars/Liquid from the MJML parser |

---

## Known Gotchas

**Vertical-align consistency**: If any `<mj-column>` in a section sets `vertical-align`, every column in that section must also set it explicitly. A single unset column causes inconsistent rendering.

**Background image support**: VML (Outlook-compatible background images) is only generated for `<mj-section>` and `<mj-hero>`. `<mj-column>` background images are not VML-rendered and will not show in Outlook.

**Ending tags**: `<mj-text>`, `<mj-button>`, `<mj-table>`, and `<mj-raw>` are ending tags — their content is raw HTML, not processed by the MJML engine. Do not nest other MJML components inside them.

**Minify and `<` characters**: With `--config.minify=true`, bare `<` characters inside ending tags cause parse errors. Wrap in `<!-- htmlmin:ignore -->` or escape as `&lt;`.

---

## Installation

This is a [Claude Code](https://claude.ai/code) skill. Listed on [skills.sh](https://skills.sh/framix-team/skills/email-html-mjml).

**Option A — npx skills (recommended)**

```bash
npx skills add framix-team/skill-email-html-mjml
```

Requires the [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI. Installs directly into `~/.claude/skills/` and works with Claude Code, opencode, and other compatible agents.

**Option B — Clone and copy**

```bash
git clone https://github.com/framix-team/skill-email-html-mjml
cp -r skill-email-html-mjml/email-html-mjml ~/.claude/skills/
```

**Option C — Download ZIP**

1. Download this repo as a ZIP from GitHub → **Code → Download ZIP**
2. Unzip it
3. Copy the inner `email-html-mjml/` folder to your skills directory:

```bash
cp -r skill-email-html-mjml-main/email-html-mjml ~/.claude/skills/
```

**Verify the install**

```bash
ls ~/.claude/skills/email-html-mjml/
# Should show: SKILL.md  compilation.md  mjml-reference.md  components/  assets/
```

**Claude.ai**

Upload the `email-html-mjml/` folder (zipped) via **Settings → Capabilities → Skills → Upload skill**.

Once installed, Claude will automatically invoke the skill when you ask it to create, generate, or build an HTML email template, or when you ask it to compile MJML or troubleshoot email rendering issues.

---

## Requirements

- **Claude Code** (Claude Sonnet 4.6 or later recommended)
- **Node.js** ≥ 14 (for `npx mjml` compilation)
- **MJML** — installed per project, not globally:
  ```bash
  npm install -D mjml
  ```

MJML is never installed globally (`npm install -g mjml` is explicitly avoided). Each project pins its own version. For new projects, pin to the latest stable MJML 4.x release:

```json
{
  "devDependencies": {
    "mjml": "^4.15.3"
  }
}
```

---

## Repository Structure

```
skill-email-html-mjml/           ← repo root (GitHub)
├── README.md                    ← this file
└── email-html-mjml/             ← installable skill folder
    ├── SKILL.md                 ← skill definition and workflow
    ├── compilation.md           ← compilation workflow and error recovery
    ├── mjml-reference.md        ← MJML architecture, validation, width math
    ├── components/
    │   ├── head.md              ← mj-attributes, mj-font, mj-style, mj-html-attributes
    │   ├── layout.md            ← mj-section, mj-column, mj-group, mj-wrapper
    │   ├── content.md           ← mj-text, mj-image, mj-button, mj-divider, mj-table
    │   ├── interactive.md       ← mj-social, mj-navbar, mj-accordion, mj-carousel
    │   └── advanced.md          ← mj-hero, mj-raw, mj-include
    └── assets/
        └── examples/
            └── basic-layout.mjml  ← MJML docs basic layout (structural reference)
```

Component reference files are loaded on-demand — only the files relevant to the current template are read into context. This keeps token usage minimal for simple templates while making the full reference available for complex ones.

---

## License

MIT

---

## Made by

[Framix](https://www.framix.net/) — Growth Web Presence for Scaling Companies