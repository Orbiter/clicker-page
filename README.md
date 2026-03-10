# clicker.page

Turn your existing Markdown into a presentation deck.

Drop a `README.md`, a markdown link or file into this page.
clicker.page turns it into slides you can present immediately, without rebuilding the content in another slide tool.

Ideal for demos, docs, technical talks, and workshops.

-> Click anywhere to see the manual.

## Quickstart

- Keep writing documents in Markdown
- Get slide layouts automatically
- Share decks from a source URL
- Present local files during development

-> Navigation: click to next page

### Keys and Functions

- `ArrowRight` / `ArrowDown` / click: next slide
- `ArrowLeft` / `ArrowUp`: previous slide
- swipe: navigate
- `+` / `-`: content font size
- `☀` / `☾`: light or dark mode
- theme buttons: switch visual language

The source URL stays visible in the header and can be copied or opened directly.

-> Want to see the style guide? Click to get to the next page!

## Markdown Becomes Deck Layout

Slides are split by natural authoring markers:

- `#` and `##` headlines
- horizontal rules `---`

Everything between is a slide in your slide deck.

Markdown then becomes a styled presentation surface with post-render layout rules.

## Images Can Drive The Slide

![Portrait left example](./examples/portrait-left.svg)

Portrait images can trigger split-screen layouts.

- image first: image on the left
- image last: image on the right

The other side is your markdown text inside the same 

## One-Image-Only slides Become Hero Slides

![Landscape light example](./examples/landscape-light.svg)

## One-Image-Only slides Become Hero Slides

![Landscape light example](./examples/landscape-dark.svg)

## Text Can Be Enhanced

Markdown emphasis and semantic patterns are styled after rendering:

- `**bold**` becomes marker-like emphasis
- chains like intake -> refine -> deliver get a warp effect
- `inline code` gets theme-aware chip styling

The pipeline lights up when a sentence contains a chain like intake -> refine -> deliver, and `updateSourceQuery(...)` stays readable inside running prose.

## Code Blocks Become Presentation Elements

```js
function renderSlideInto(targetEl, slideMarkdown, slideIndex, renderToken, options) {
  const renderedTemplate = document.createElement('template');
  renderedTemplate.innerHTML = renderMarkdown(slideMarkdown);
  mountRenderedContent(targetEl, renderedTemplate.content);
}
```

- line numbers
- themed code surfaces
- copy button
- automatic width fitting

Code automatically fits in the box, if required the font size is reduced.

## Tables Are Styled, Too

| Feature | Result | Q1 | Q2 |
| --- | --- | ---: | ---: |
| header bands | stronger structure | 12 | 18 |
| row rhythm | easier scanning | 24 | 31 |
| image-only tables | borderless stitched gallery | 4 | 6 |

|  |  |
| --- | --- |
| ![Portrait left](./examples/portrait-left.svg) | ![Portrait right](./examples/portrait-right.svg) |
| ![Landscape dark](./examples/landscape-dark.svg) | ![Landscape light](./examples/landscape-light.svg) |

## Bullet Lists Can Reveal Progressively

- first bullet is visible immediately
- next bullets appear step by step
- nested content belongs to its parent bullet
- code blocks can live inside a revealed bullet
- tables and image sets can live inside a revealed bullet

## Local And Remote Markdown Both Work

- drop a local `.md` file
- drop a markdown URL
- keep the current source in the URL
- reload directly into the same deck
- optionally watch a local source file in local dev mode

This makes `README.md` files, notes, docs, and demos presentation-ready without a second slide tool.

