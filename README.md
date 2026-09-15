# Verify with Gemini

<p align="center">
  <img src="icon.jpg" alt="Verify with Gemini" width="420" />
</p>

Chrome extension that adds a **Verify** button on images. Click it to copy the image, open [Gemini](https://gemini.google.com), paste it, and ask your custom prompt (default: **is this true?**).

**Privacy Policy:** [PRIVACY.md](./PRIVACY.md)

## Install

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select the `extension` folder
5. Stay signed in to Google / Gemini in Chrome

## Use

1. Open a site with images (X, news, etc.)
2. Click the blue **Verify** button on a photo
3. Gemini opens with your saved prompt

## Settings

Open the extension popup to set the prompt in any language, for example:

- `is this true?`
- `isso é verdade?`
- `¿es esto verdad?`

## Note

Chrome may ask to allow debugging for the paste step. A short debug banner on the Gemini tab is normal and goes away after paste.
