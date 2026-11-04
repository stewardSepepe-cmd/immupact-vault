# Changelog

## 0.4.0
- Reads ImmuPact's new document-first PDFs (from November 2026): the signed document comes first and a certificate of completion follows. The Vault finds the document title, identifiers and wording in both the new and the original layout.

## 0.3.0
- **Save to Vault from ImmuPact**: the Vault handles `immupact-vault://import` links. It finds the downloaded file in your watch folder, confirms the ImmuPact document ID printed inside the PDF, and asks before adding it. It waits for you to unlock if the vault is locked, and tells you if the document is already stored. Links are treated as untrusted (see docs/SPEC.md section 7).

## 0.2.0
- **Viewer**: read documents inside the vault. Decrypted in memory only, in a locked-down window that closes when the vault locks. Optional screenshot protection.
- **Export original**: the byte-for-byte file for sharing, with a clear warning, an optional note and an optional legal hold.
- **Verification pack**: a ZIP with the untouched PDF, a one-page verification sheet, `proof.json` and instructions for checking it independently.
- **Shared copies log**: every export is recorded in the encrypted index. Destruction receipts say how many copies left the vault.
- **Names and notes**: rename any document, add private notes, and search them. Smarter default names (your own file name, else the document title).
- New logo and app icons.
- Dependencies updated: Electron 45, electron-builder 26, pdf.js 6.4, ethers 6.17. Node.js 22.13 or later.
- The ImmuPact verify address defaults to `https://immupact.com/functions/publicVerify`.
- The Vault refuses passphrases shorter than 12 characters.

## 0.1.0
- First release: encrypted vault, on-chain verification, retention rules with legal hold, signed destruction receipts, encrypted backup, Downloads watcher.
