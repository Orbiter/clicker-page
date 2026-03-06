# AGENT.md

## Project Intent

`clicker-page` is a single-page Markdown slide viewer.
The architecture must stay clean, minimal, and easy to reason about.

## Core Design Principles

- Keep the implementation lightweight.
- Prefer vanilla HTML/CSS/JavaScript over frameworks.
- Do not use large CSS frameworks.
- Do not load external assets from CDNs.
- Only load local project assets required to render the page.

## Layout and Screen Model

- The app is a one-screen slide surface.
- The outer page itself must not scroll.
- Slides are rendered in horizontal presentation style.
- The viewport should always behave like a slide deck canvas.
- Content transitions are page-based, not free-scroll based.

## Slide Navigation Behavior

- Keyboard navigation:
  - `ArrowDown` and `ArrowRight` go to next page.
  - `ArrowUp` and `ArrowLeft` go to previous page.
- Mobile navigation:
  - Swipe left/up goes to next page.
  - Swipe right/down goes to previous page.
- Content may appear scroll-like only through page transitions.
- No continuous document scrolling interaction.

## Mobile Requirements

- Mobile rendering must follow panorama (landscape) slide behavior.
- Mobile output should mirror desktop presentation logic and layout.
- Interaction parity between desktop and mobile is required.

## Theme and Styling

- Support simple theming with light mode and dark mode.
- Initial implementation should stay black/white.
- Keep styling minimal and functional.
- Any style additions must preserve performance and simplicity.

## Header Specification

- A persistent top headline/header is required.
- In dark mode, the header is always visible.
- Left side of the header must display: `https://clicker.page`.
- Remaining header space is for control buttons.
- Buttons are visible only on mouse-over/hover.
- Button style:
  - thin white border,
  - simple icon-only design,
  - icons implemented as SVG graphics.

## Asset and Code Organization

- JavaScript public path: `/js/`
- CSS public path: `/css/`
- Keep file structure straightforward and maintainable.
- Prefer small, focused files.

## Dependency Policy

- Avoid external runtime dependencies when possible.
- Never load JS or CSS from a remote CDN at runtime.
- If a new third-party JS or CSS asset is required, download it once and vendor it into the local `/js/` or `/css/` folder, then reference that local file.
- Any new CSS utility or JS library must be evaluated for:
  - bundle/runtime weight,
  - simplicity,
  - long-term maintainability,
  - necessity for core functionality.
- If a dependency is not clearly needed, do not include it.

## Local Browser Verification

- You may use the locally installed Google Chrome browser to test and inspect the page yourself.
- Prefer local browser verification for layout, styling, interaction, and rendering issues instead of asking the user to manually confirm each change.
- If browser automation or local serving is required for verification, it is allowed.

## Architecture Guidance

- Use a clear separation of concerns:
  - markdown input/loading,
  - markdown parsing and slide segmentation,
  - rendering,
  - navigation state,
  - UI controls.
- Keep state management minimal and explicit.
- Build for progressive enhancement and robust fallback behavior.

## Non-Goals

- No heavy UI frameworks.
- No visual bloat.
- No feature creep that compromises the one-page slide experience.
