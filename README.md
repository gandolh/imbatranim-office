# imbatranim-office

The office apps for imbatranimOS: Docs, Sheets, Slides, PDF and CAD. They
install together from the OS's Marketplace and open in OS windows like any
other app, with the desktop's own buttons, dialogs and theme.

Nothing is built yet. The plan is in [`corpus/`](corpus/index.md): what was
decided and why in [`corpus/wiki/decisions.md`](corpus/wiki/decisions.md), the
work in [`corpus/wiki/status.md`](corpus/wiki/status.md).

## How it fits the OS

- One catalog entry in the imbatranimOS repo installs the whole suite at a
  pinned commit of this repo. The OS clones it, runs its build, and lists five
  apps.
- Each app is a React component that the desktop renders with its own React and
  kit, so it behaves like a built-in app.
- Editing runs in the browser. A server, where an app needs one, does one-off
  jobs such as converting a file or exporting a PDF.

## License

AGPL-3.0-only, the same as imbatranimOS. See [LICENSE](LICENSE).
