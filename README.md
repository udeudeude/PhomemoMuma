# PhomemoMuma

An independent, mobile-first **general document printer** for the **Phomemo M02**. Open it on an iPhone in **Bluefy** and print directly to the M02 over Bluetooth. No Phomemo account, official app, computer, or local Wi-Fi network is required to communicate with the printer.

**Open:** https://udeudeude.github.io/PhomemoMuma/

## What the application is for

Print PDFs, ordinary documents exported as PDFs, photos, diagrams, and plain text. This is **not primarily a receipt/label composer**. A supplementary text-and-image strip editor is available at `app.html`.

### Document printing

- Import PDFs and text/image files using the iPhone's Files picker.
- Preview individual PDF pages and print one page or a selected page range.
- Three layout modes:
  1. **Whole page** retains the source layout, scaled to the 384-dot print width.
  2. **Trim blank margins** crops whitespace before shrinking, preserving layout at a slightly larger scale.
  3. **Readable text** extracts selectable PDF text and rewraps it for the narrow paper. This is experimental; intricate tables, typography, and multicolumn layouts will not retain their original structure. Scanned PDFs generally lack selectable text.
- Monochrome thresholding for text/diagrams, dithering for photographs, contrast adjustment, rotation, and adjustable margins.
- Actual 384-pixel monochrome preview plus PNG export.
- One page at a time is rasterized and transmitted in row chunks, avoiding loading an entire multipage document as one giant image.

## Device limitations

The original M02 has **384 printable dots** (approximately 48 mm of print width) at **203 dots per inch**, on 53 mm paper. Full US letter or A4 pages become miniatures, and dense small text may not be legible. Use margin trimming or text reflow when legibility matters.

A conventional iPhone **Share → Print → Select Printer** workflow is **not currently supported**: a website in Bluefy cannot register the printer as an AirPrint destination. Import the file using Bluefy instead. A future native application or suitable AirPrint bridge could change the integration route; a bridge would require additional hardware.

## Using it on iPhone

1. Turn on your Phomemo M02 and close the official Phomemo app if it is connected.
2. Open the site above **in Bluefy**, not Safari.
3. Choose a PDF from Files, preview a page, and choose the layout.
4. Tap **Connect M02** and select your printer.
5. Tap **Print this page** or **Print selected pages**.

For a webpage, first create a PDF using the iOS share/print/export facilities and save it in Files. Then open the PDF in PhomemoMuma.

## Technical status

**Verified on physical hardware:** Bluefy can discover and connect to a user's M02 via Bluetooth service `FF00` and writable characteristic `FF02`. A short 384-dot raster print and a longer variable-height text print both succeeded.

**Awaiting physical verification:** The new PDF/document workflow, high-length multi-page printing, and the density comparison. Images and PDFs are processed within the browser without being uploaded to a service.

The PDF renderer uses Mozilla PDF.js, currently referenced by its pinned version on a content-delivery network. A network connection may be necessary the first time the renderer is fetched; offline reuse is cached where the browser supports it. Do not assume offline PDF printing is guaranteed until it has been tested in Bluefy.

## Utility pages

- [Document printer](https://udeudeude.github.io/PhomemoMuma/): main application
- [Short print and density calibration](https://udeudeude.github.io/PhomemoMuma/print.html)
- [Bluetooth diagnostic](https://udeudeude.github.io/PhomemoMuma/diagnostic.html)
- [Text and image strip editor](https://udeudeude.github.io/PhomemoMuma/app.html)

## Protocol

Printing uses the previously confirmed connection path and the M02 raster protocol: thermal density setup, `GS v 0` row images split into safe batches, and feed/finalization commands. BLE data is sent to the `FF02` characteristic in 20-byte writes with pacing.

This project is not affiliated with Phomemo.
