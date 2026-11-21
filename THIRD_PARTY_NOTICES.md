# Third-party notices

The bundled userscript (`dist/folio.user.js`) includes these runtime dependencies:

- [Preact](https://preactjs.com/), MIT License
- [unified](https://unifiedjs.com/), [remark-parse](https://github.com/remarkjs/remark), [remark-gfm](https://github.com/remarkjs/remark-gfm), [remark-stringify](https://github.com/remarkjs/remark), [remark-rehype](https://github.com/remarkjs/remark-rehype), [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize), [rehype-stringify](https://github.com/rehypejs/rehype-stringify), [mdast-util-to-string](https://github.com/syntax-tree/mdast-util-to-string), MIT License

Lazy-loaded external vendor asset (copied to `dist/vendor/mermaid.min.js`, not inlined into `dist/folio.user.js`):

- [Mermaid 11.16.0](https://github.com/mermaid-js/mermaid), MIT License

Platform hostnames, editor selectors, and editor-API discovery were cross-checked against [Doocs COSE](https://github.com/doocs/cose) commit `e70fa9e92a71cd2f10e0c883981f324a332162d4`, MIT License.

Mermaid lazy initialization and SVG-to-PNG conversion were cross-checked against [Doocs Markdown Editor](https://github.com/doocs/md) commit `b867c6026347ef193ed423a102761d82f04bc585`, WTFPL.
