# Privacy Policy — Verify with Gemini

**Last updated:** September 15, 2026  
**Extension:** Verify with Gemini  
**Publisher:** [badjano](https://github.com/badjano)  
**Source code:** https://github.com/badjano/verify-with-gemini

This Privacy Policy explains how the **Verify with Gemini** Chrome extension (“the Extension”) handles information when you install and use it.

## 1. Summary

- The Extension does **not** collect, sell, or upload your personal data to a developer-operated server.
- The only setting stored by the Extension is your optional **custom verification prompt** (for example, “is this true?”), saved in Chrome’s storage on your device / synced Google account.
- When you click **Verify**, the selected image is copied to your clipboard and opened in **Google Gemini** (`gemini.google.com`) in your browser. From that point, Google’s own terms and privacy policy apply to Gemini.

## 2. Who we are

Verify with Gemini is an open-source Chrome extension published by **badjano**.  
Contact / questions: open an issue at https://github.com/badjano/verify-with-gemini/issues

## 3. What the Extension does

The Extension helps you check images you see on the web by:

1. Showing a **Verify** control on images (and/or a right-click menu item).
2. Copying the image you chose to the clipboard after you explicitly act.
3. Opening or focusing Google Gemini and pasting the image with your saved prompt.

## 4. Data we process (and where)

| Data | Stored by us on our servers? | Where it goes |
|------|------------------------------|---------------|
| Custom prompt text | No | Chrome `storage` on your device / Chrome sync |
| Selected image | No | Your system clipboard, then Gemini in your browser after you click Verify |
| Page content / browsing history | No | Not collected |
| Analytics / advertising IDs | No | Not used |

We do **not** operate a backend that receives your images, prompts, or browsing activity.

## 5. Permissions (why they are used)

- **storage** — Save your custom prompt.
- **tabs** — Open or focus the Gemini tab after you click Verify.
- **scripting** — Show the Verify UI on pages and help complete paste on Gemini.
- **contextMenus** — Optional “Verify with Gemini” on right-click for images.
- **clipboardWrite** — Copy the selected image after your explicit action.
- **debugger** — Briefly attach to the Gemini tab only to perform a trusted paste, because Gemini blocks ordinary scripted paste. Detached afterward. Not used to read other sites.
- **Host access (broad)** — So Verify can appear on images across sites you visit. No background scraping; action is user-initiated.

## 6. Third parties

### Google Gemini
When verification runs, your browser interacts with Google’s Gemini website. That use is governed by Google’s policies, including:

- https://policies.google.com/privacy  
- https://policies.google.com/terms  

We do not control Google’s processing of data you submit in Gemini.

### Chrome / Google account sync
If Chrome sync is enabled, your prompt setting may sync through Google’s Chrome sync infrastructure under Google’s terms.

## 7. Remote code

The Extension does **not** download or execute remote code. All extension logic is included in the package you install from the Chrome Web Store or load unpacked from this repository.

## 8. Children’s privacy

The Extension is not directed at children under 13, and we do not knowingly collect children’s personal information.

## 9. Changes to this policy

We may update this Privacy Policy by committing changes to this file in the repository. The “Last updated” date at the top will change when we do. Continued use of the Extension after updates means you accept the revised policy.

## 10. Contact

For privacy questions about this Extension:

- GitHub Issues: https://github.com/badjano/verify-with-gemini/issues  
- Publisher profile: https://github.com/badjano

If you published the Extension with a verified Chrome Web Store contact email, you may also use that email for privacy requests related to the Store listing.
