# ImmuPact Vault: design specification (v0.1)

## 1. Goals

1. Keep a person's final, signed documents **on their own device**, readable only by them.
2. Prove a document's authenticity **directly from the blockchain**, without relying on ImmuPact's servers.
3. Let the owner **destroy** documents on a schedule they choose, with proof that the destruction happened.
4. Stay **independent** of ImmuPact. The only shared element is the open verification standard in section 3.

Not goals for v0.1: sharing with other people, cloud hosting, mobile.

## 2. Architecture

```
src/
  core/        Plain Node.js. No Electron, so it can be tested and reused.
    standard.js  networks, contract addresses, ABIs, file fingerprint
    pdf.js       reads ImmuPact identifiers and the wording digest from a PDF (pdf.js, no rendering)
    verify.js    on-chain verification and the optional online wording check
    crypto.js    key derivation, AES-GCM, recovery phrase, Ed25519 receipts
    retention.js retention rules (pure functions)
    store.js     the Vault class: the on-disk format and all operations
    importer.js  add a file = encrypt + inspect + verify
  main/        Electron main process: IPC, auto-lock, timers, Downloads watcher
    preload.js   exposes a small, named API as window.vault (contextBridge)
  renderer/    The UI: plain HTML/CSS/JS with a strict CSP
```

Electron hardening:
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- No remote content. External links open in the system browser, and only for an allowlist.
- The CSP allows only `'self'` for scripts, and `'unsafe-inline'` for styles only.

## 3. The ImmuPact verification standard

Each ImmuPact `-FINAL.pdf` prints these identifiers:

- Contract ID (24 hex characters)
- On-chain agreement ID (`0x` + 64 hex)
- Content Hash
- Seal TX Hash

The Vault computes three values:

| Value | Definition | Used for |
|---|---|---|
| File fingerprint | `keccak256(exact file bytes)` | the on-chain exact-match check |
| Content hash | `keccak256(content + title + "\|annexures:" + sorted annexure ids)` | read from the PDF only |
| Wording digest | `keccak256` of the text between `CONTRACTCONTENT` and the next section marker (`IMMUTABLEANNEXURES…` or `AUDITTRAIL<n>immutablerecord(s)`). All whitespace is removed, and text in the footer band (y < 40 pt) is ignored. | the optional online "genuine wording" check |

How the on-chain check works (`verify.js`):
- **ImmuPact Core v2.** `verifyDocument(agreementId, fileHash)` returns a kind: `0` none, `1` content, `2` final_document. Kind 2 means **anchored**.
- **Core v1.** Used as a fallback for older agreements.
- **Unknown agreement.** If the agreement doesn't exist or the call reverts, the result is `not_found`.
- **Network failure.** If every RPC fails, the result is `unknown`, and importing stores the file as `unchecked`.
- **Several RPCs.** The Vault tries several public RPCs in turn.

The wording-digest definition must stay identical to ImmuPact's `src/lib/pdfContent.js`. Changing it is a version bump of the standard (`STANDARD_VERSION`).

## 4. Keys and encryption

```
recovery phrase (24 words, BIP-39)  <=>  vault key K (32 random bytes)
passphrase --scrypt(N=2^17,r=8,p=1, salt)--> wrapping key W
vault.json stores AES-256-GCM_W(K)

index key  = HKDF-SHA256(K, "immupact-vault/index")
index.enc  = AES-256-GCM_indexKey(JSON index), AAD = vault ID

per file: random 32-byte key F, random 12-byte nonce
blobs/<blobId>.bin = AES-256-GCM_F(file bytes), AAD = blobId
F is stored only inside the encrypted index
```

- **Changing the passphrase** re-wraps K. Files aren't re-encrypted.
- **Recovery** rebuilds K from the phrase and lets you set a new passphrase.
- **Receipt signing.** An Ed25519 key pair is created with the vault. The private key lives in the encrypted index; the public key is in `vault.json`, so anyone with the vault folder can check receipts.
- **Canonical JSON.** Receipts are signed over canonical JSON (sorted keys).

## 5. Retention ("self-destruct")

A rule is one of:
- `{mode:'keep'}`
- `{mode:'destroy_on', date}`
- `{mode:'destroy_after', days, from:'added'|'sealed'}`

How the rule for a document is chosen:
1. The document's own rule, if it has one.
2. Otherwise, its folder's rule.
3. Otherwise, keep.

An explicit `keep` on a document overrides a folder's destroy rule.

Safeguards:
- **Legal hold.** A legal hold on a document or its folder blocks destruction.
- **Minimum retention.** A rule that keeps a document for less than the minimum (default 2190 days, about 6 years) is refused unless the user acknowledges it. A minimum of 0 turns the check off.
- **When it runs.** Enforcement runs every 10 minutes while the vault is unlocked, and at unlock.

While the vault is locked:
- `schedule.json` maps blob ID to destroy-by date, in plaintext. It contains no names and no contents.
- At start-up, `Vault.sweepSchedule()` deletes blobs whose date has passed.
- At the next unlock, `_reconcileLockedDestructions()` finishes the destruction (drops keys, writes receipts). It also flags any other blob that has gone missing.

Destruction does the following:
1. Deletes the blob.
2. Deletes the file key from the index.
3. Clears the wording digest.
4. Records `destroyedAt`.
5. Appends a signed receipt.

The receipt payload contains:
- `type`, `version`
- `vaultId`, `documentId`
- `name`, `fileHash`, `contractId`, `agreementId`
- `reason` (`manual` or `retention_rule`), `rule`, `destroyedAt`

## 6. Threat model

| Threat | Covered? |
|---|---|
| Someone copies the vault folder (stolen laptop, leaked backup) | Yes. Everything except IDs and dates is encrypted, and the passphrase is stretched with scrypt. |
| Someone tampers with a stored file | Yes. AES-GCM authentication fails, and the on-chain re-check fails. |
| Someone swaps one encrypted file for another | Yes. The associated data binds each file to its ID. |
| ImmuPact's servers are down, or ImmuPact disappears | Yes. Verification uses public RPCs only. |
| A malicious RPC lies about the chain | Partly. Several RPCs are tried, but not cross-checked (roadmap). |
| Malware running as the user while the vault is unlocked | No. That's out of scope for any desktop app. |
| Copies outside the Vault, or backups made before a destruction | No. This is documented to users. |
| A weak passphrase | Partly. scrypt slows guessing, and the Vault refuses passphrases under 12 characters. |

## 7. Hand-off from ImmuPact ("Save to Vault")

The app registers `immupact-vault://` but ignores it in v0.1. The planned flow:
1. ImmuPact opens `immupact-vault://import?ref=<contractId>`.
2. The Vault asks the user to confirm.
3. The user picks the downloaded file.

The Vault never fetches documents from ImmuPact. Until this is built, the Downloads watcher picks up new `*-FINAL.pdf` files.

## 8. On-disk format versioning

`vault.json.format` is `1`. A future format must be able to migrate format 1 in place, and must not reduce the security in section 4.

## 9. Reading and sharing (v0.2)

### Viewer
- `docs:view` decrypts the file in the main process and opens a separate `BrowserWindow`:
  - `sandbox`, `contextIsolation`, no Node integration
  - its own non-persistent session (`partition: viewer-<uuid>`): no cache, storage or permissions shared with the vault window
  - every permission request is denied
  - navigation and new windows are blocked
  - Ctrl/Cmd+P and Ctrl/Cmd+S are swallowed
- How the bytes reach the window:
  1. The main process keeps them in memory, keyed by the window's `webContents` id.
  2. The window's preload can call `viewer:load` once. The bytes are handed over (structured clone) and the main copy is zero-filled.
  3. Locking the vault closes every viewer window.
- Rendering:
  - pdf.js (`pdfjs-dist`, bundled) runs on the page's own thread. Its worker module is imported and exposed as `globalThis.pdfjsWorker`, so no Worker or worker URL is needed.
  - `isEvalSupported: false`, `enableXfa: false`. There is no text or annotation layer: pages are drawn to canvas only, lazily as they scroll into view.
  - Images (PNG, JPEG, GIF, WebP) are shown from a `blob:` URL.
  - Other file types can't be viewed.
- CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'none'; worker-src 'none'`.
- Optional: `setContentProtection(true)` (setting `protectViewer`) hides viewer windows from screenshots and screen sharing on macOS and Windows.

### Exports
- **Original** (`docs:exportOriginal`): the decrypted bytes, unchanged, written where the user chooses.
- **Verification pack** (`docs:exportPack`):
  1. The vault re-checks the chain first. If it's offline, it keeps the last result.
  2. It writes a ZIP (stored, no compression) holding:
     - the original file
     - `VERIFICATION-SHEET.pdf`, one page made with pdf-lib and standard fonts
     - `proof.json`
     - `HOW-TO-VERIFY.txt`
- `proof.json` (`type: immupact/verification-pack`, `version: 1`) records:
  - the file name and size
  - the keccak-256 fingerprint, which is the on-chain value
  - the SHA-256, for checking the copy arrived intact with everyday tools
  - the network, chain ID, contract address, agreement ID, content hash and seal transaction
  - explorer links
  - the verdict at export, with its check time
- The sheet and instructions describe two ways to check, and say plainly that the sheet isn't a certificate:
  - the quick way, at verify.immupact.com
  - the independent way: `keccak256(file)` plus `verifyDocument(agreementId, fileHash)` on the contract, where kind 2 means final document
- Each export appends `{at, kind, note, fileName}` to the document's `exports` in the encrypted index. Only the base name is kept, not the folder. Destruction receipts include `exportedCopies`.

### Names
- `name` (the original file name) and `ids.title` (the title printed on the PDF, which is part of the sealed fingerprint) never change.
- `label` is the owner's own name for the document: up to 120 characters, editable at any time, and stored only in the encrypted index.
- The display name is the label, or else a default:
  1. a file name the owner chose (for example, one saved under their ImmuPact private label)
  2. otherwise the PDF's title
  3. otherwise the file name
- Generic `immupact_<type>_<id>` and title-based names fall through to the title.
- Receipts carry both `name` and `displayName`.
