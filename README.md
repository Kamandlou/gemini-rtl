# Gemini RTL

A Chrome and Firefox extension that adds automatic right-to-left text direction to [Gemini](https://gemini.google.com/), with manual controls for messages and the prompt box.

## Features

- Detects RTL and LTR text in Gemini responses and prompts.
- Adjusts direction as responses stream in.
- Adds a direction button to responses and the prompt box.
- Supports `Ctrl`/`Cmd` + right Shift for RTL and `Ctrl`/`Cmd` + left Shift for LTR while typing.
- Keeps code and math left-to-right when enabled.
- Saves preferences with browser sync storage.
- Optionally uses a bundled Vazirmatn font for Gemini text (off by default).

## Install in Chrome

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select this repository's folder.
4. Open [Gemini](https://gemini.google.com/) or reload an existing Gemini tab.

## Test in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `manifest.json` from this folder.
3. Open [Gemini](https://gemini.google.com/) or reload an existing Gemini tab.

Temporary add-ons are removed when Firefox closes. A permanent Firefox installation requires a signed add-on package.

## Credits

Made with Coffee & Love by Amir Hossein Kamandlou.

## License

MIT. See [LICENSE](LICENSE).

The bundled Vazirmatn font is licensed separately under the [SIL Open Font License 1.1](fonts/OFL.txt).
