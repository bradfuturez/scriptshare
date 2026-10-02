# ScriptShare

A tiny installable (PWA) phone editor for a trailer script laid out as rows of **Time · Character · Shot · Line · Notes**.

- Static HTML/CSS/JS, no build step. Hosted on GitHub Pages.
- **No script content lives in this repo.** The script is loaded from and saved to a private data repo
  (`script.json`, plus a dated copy in `history/` on every save) with the GitHub Contents API.
- Auth: a fine-grained personal access token limited to the data repo with *Contents: Read and write*.
  It is pasted once and stored only in the browser's `localStorage`.
- Edits are autosaved as a local draft, so nothing is lost offline; Save commits when online.
