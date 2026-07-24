# Third-party notices

The bundled userscript includes these runtime dependencies:

- [Marked 18.0.6](https://github.com/markedjs/marked), MIT License
- [Mermaid 11.16.0](https://github.com/mermaid-js/mermaid), MIT License
- [DOMPurify 3.4.12](https://github.com/cure53/DOMPurify), Apache-2.0 or MPL-2.0
- [Turndown 7.2.4](https://github.com/mixmark-io/turndown), MIT License
- [Turndown Plugin GFM 1.0.2](https://github.com/mixmark-io/turndown-plugin-gfm), MIT License

Platform hostnames, current editor selectors, and editor-API discovery were cross-checked against [Doocs COSE](https://github.com/doocs/cose) commit `e70fa9e92a71cd2f10e0c883981f324a332162d4`, MIT License. This project does not copy COSE's automatic publishing behavior.

Mermaid lazy initialization, bounded diagram caching, and SVG-to-PNG conversion behavior were cross-checked against [Doocs Markdown Editor](https://github.com/doocs/md) commit `b867c6026347ef193ed423a102761d82f04bc585`, WTFPL. DraftFerry keeps its own userscript-specific renderer and publication-size policy.

License comments emitted by the bundler are retained at the end of `dist/draftferry.user.js`.
