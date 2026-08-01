# Code Intelligence Platform Guide Site

A zero-build static documentation site designed for Vercel. It mirrors the repository README by version and presents it with:

- version selector (`1.0.8` and `main`)
- automatically generated page navigation from README sections
- responsive left navigation and right-side table of contents
- full-text section search
- syntax highlighting and copy buttons for code blocks
- Copy Markdown and Original Source actions
- ContextQMD-style URL structure

## Local preview

```bash
npx serve .
```

## Vercel setup

Import the repository in Vercel and set **Root Directory** to `guide`.

No build command is required. Vercel serves `index.html` as a static site and uses `vercel.json` to rewrite documentation routes.
