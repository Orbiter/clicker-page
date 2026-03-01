# clicker-page

Turn any Markdown document into a clickable, keyboard-driven slide deck.

---

## The Problem

Great project READMEs are often already great presentations.

But teams still rebuild the same content in separate slide tools.

That duplication costs time, creates drift, and weakens documentation.

---

## The Idea

`clicker-page` is a single web page that renders Markdown as slides.

Use one source of truth.

Write once.

Present anywhere.

---

## Input Sources

The page can load Markdown in two ways:

1. **Drag and drop** a local `.md` file onto the browser window.
2. **Load from URL** (for example raw GitHub content URLs).

Because raw GitHub content endpoints provide CORS headers, the page can fetch those files directly in the browser.

---

## Slide Model

A Markdown file is split into pages using natural authoring markers:

- Horizontal rules (`---`)
- `#` headlines
- `##` headlines

This keeps authoring simple and readable in plain text.

---

## Navigation

Presentation flow is keyboard-first:

- `ArrowDown` / `ArrowRight`: next page
- `ArrowUp` / `ArrowLeft`: previous page

No export step.
No proprietary format.
No lock-in.

---

## Why This Matters

A strong README should be enough to:

- explain a project,
- onboard contributors,
- and present the idea to stakeholders.

With `clicker-page`, documentation and presentation become the same artifact.

---

## Authoring Philosophy

Write Markdown for humans first.

Keep hierarchy clear.

Use meaningful headings.

Insert horizontal rules where narrative breaks matter.

If it reads well in a repository, it should present well on a screen.

---

## Example Source URL

You can load Markdown from URLs such as:

`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/README.md`

This makes any public repository instantly presentable.

---

## Showcase Pages

These are standalone markdown files you can drop directly into `clicker-page`:

1. [Aurora Launch Story](./showcases/aurora-launch-story.md)  
   Product narrative with blockquote, metrics table, and code snippet.
2. [Oceanic Design Manifesto](./showcases/oceanic-design-manifesto.md)  
   Clean typography-focused deck with principles and color system.
3. [Alpine Travel Brief](./showcases/alpine-travel-brief.md)  
   Visual travel story with itinerary, remote image, and concise structure.

---

## Project Goals

- One-page app
- Fast startup
- Zero build friction for end users
- URL + drag-and-drop input
- Clean slide navigation from Markdown structure

---

## Non-Goals (for now)

- Heavy slide design tooling
- Complex animation systems
- Proprietary presentation syntax

The priority is clarity, portability, and reusability.

---

## Who This Is For

- Open source maintainers
- Developer advocates
- Engineering teams
- Technical founders
- Anyone who already writes Markdown and presents ideas

---

## Vision

README-first communication.

When project docs are written well, they become:

- your docs,
- your pitch,
- your onboarding,
- your slides.

`clicker-page` is the thin layer that unlocks that workflow.

---

## Summary

`clicker-page` treats Markdown as a presentation-native format.

Drop a file or provide a URL.

Navigate with arrow keys.

Present directly from the same content you maintain in version control.
