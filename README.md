# ImmuPact Vault

A personal, encrypted wallet for your signed agreements. It runs on your own computer.

ImmuPact anchors agreements on the blockchain, but it doesn't keep your final documents. The Vault holds them for you:

- **Only you can open it.** Every file is encrypted on your device. There's no account and no server, and nobody else holds a copy of your key.
- **It verifies without ImmuPact.** The Vault checks each file directly against the ImmuPact contracts on Sepolia using public RPC endpoints. If ImmuPact went offline, your proof would still work.
- **It forgets on purpose.** You can give a document or a folder a retention rule, such as "destroy on 3 Nov 2032" or "destroy 6 years after sealing". When the date comes, the file is destroyed and the Vault issues a signed destruction receipt. This is the reverse of the blockchain's immutability: the proof stays on-chain forever, but the document itself doesn't have to.

> Status: **0.3.0 MVP**, desktop (macOS, Windows, Linux). It works, but it hasn't had an independent security audit. Keep another copy of anything important until it has.

## Quick start

You need Node.js 22.13 or later.

```bash
npm install
npm start        # opens the app
npm test         # unit tests (the live chain test is skipped by default)
npm run check    # syntax check of every source file
npm run dist     # builds an installer for your platform into dist/
```

`npm audit` reports a few **moderate** advisories, all in electron-builder's packaging tools (`glob`/`minimatch`). They only run on your machine when you build an installer. None of them ship inside the app. Commit the `package-lock.json` that `npm install` creates, so CI and other contributors get exactly the same versions.

To run the live blockchain test against a real anchored ImmuPact document, use the values printed on its `-FINAL.pdf`:

```bash
IMMUPACT_TEST_AGREEMENT=0x<on-chain agreement ID> \
IMMUPACT_TEST_FILEHASH=0x<keccak256 of the PDF bytes> \
npm test
```

## How you use it

1. **Create a vault.** Choose a folder and a passphrase. The Vault shows you a 24-word recovery phrase once. Write it down: it's the only way back in if you forget the passphrase.
2. **Add documents.** You can drag files in, or let the Vault watch your Downloads folder and pick up ImmuPact `-FINAL.pdf` exports automatically. Each file is encrypted, its ImmuPact identifiers are read from the PDF, and it's checked on-chain.
3. **Read the verdict.**
   - **Anchored**: these exact bytes are the file anchored on-chain.
   - **Not the anchored file**: the agreement exists, but this file isn't the one that was anchored. It might be a re-export, or it might have been edited.
   - **Not found** or **Unchecked**: there's no matching agreement, or the Vault was offline. You can re-check at any time.
4. **Read it.** **View** opens a read-only window. It decrypts the file in memory only (nothing is written to disk), shows the verdict at the top, and closes when the vault locks. It has no print or save buttons, and it never runs scripts inside PDFs.
5. **Share it.** To send a document to someone, such as an authority, a lawyer or a bank:
   - **Export original…** saves a byte-for-byte copy. It verifies as the anchored file wherever it goes.
   - **Verification pack…** saves a ZIP with that untouched PDF, a one-page verification sheet, `proof.json` and plain instructions for checking it independently. The proof sits *next to* the PDF, never inside it, because changing the PDF would break the exact match.
   - Each export is recorded in the document's encrypted **Shared copies** log, with an optional note ("Sent to HMRC, case 1234"). You can put the document on legal hold at the same time.
6. **Save from ImmuPact.** On an anchored document in ImmuPact, click **Save to Vault**. The Vault opens, finds the file you downloaded, checks inside the PDF that it is the right document, and asks before adding it. Nothing is sent to the Vault. (When running from source on macOS, the `immupact-vault://` link is only registered reliably by a built app: `npm run dist:mac`.)
7. **Name it.** Give any document your own name (for example "Bank letter for mortgage") and private notes. Search covers names, titles and notes. Names never change the file or its proof.
8. **Set rules.** Retention rules can be set per document or per folder. You can put a legal hold on anything that must not be destroyed.
9. **Back up.** The Vault copies the encrypted folder anywhere you choose, for example a folder your cloud drive syncs. The copy is useless without your passphrase or recovery phrase.

The Vault locks automatically after 10 minutes of inactivity (you can change this), and whenever the computer sleeps or the screen locks.

## Security model, in short

| Piece | What it is |
|---|---|
| Vault key | 32 random bytes. It's also your 24-word BIP-39 recovery phrase. |
| Passphrase | Stretched with scrypt (N=2¹⁷, r=8, p=1) into a key that wraps the vault key. |
| Index | Holds names, identifiers, rules and per-file keys. It's encrypted with AES-256-GCM under a key derived (HKDF) from the vault key. |
| Files | Each file has its own random AES-256-GCM key, bound to its ID with associated data. |
| Destruction | Deletes the encrypted file **and** removes its key from the index (crypto-shredding). It then writes an Ed25519-signed receipt. |
| Viewer | A separate sandboxed window with its own in-memory session. It gets the decrypted bytes once, and they're wiped when it closes or the vault locks. It has no network access, no Node.js, no workers, no printing or saving, and PDF scripts and forms are off. It can optionally be hidden from screenshots and screen sharing (macOS and Windows). |
| Exports | Exports are always the exact original bytes. A verification pack adds a proof sheet, JSON and instructions, stored uncompressed beside the PDF. The export log is kept inside the encrypted index. |
| Network | Talks only to Sepolia RPC endpoints, sending agreement IDs and hashes, never file contents. The optional online wording check sends one hash to ImmuPact. It's **off** by default. |

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Honest limits

- **Copies elsewhere aren't destroyed.** A retention rule destroys the Vault's copy. It can't reach email attachments, other people's copies or your Downloads folder.
- **Backups made before a destruction still contain the file and its key.** If destruction must be total, delete or rotate those backups too.
- **Deleting a file from an SSD doesn't guarantee the old blocks are gone.** That's why the Vault also deletes the file's key. Without the key, leftover ciphertext can't be read.
- **Files are destroyed while the vault is locked, but receipts are written later.** The plaintext `schedule.json` lists only file IDs and dates, so a locked Vault can delete files on time. The signed receipts are added the next time you unlock.
- **Exported copies are outside the Vault.** They aren't encrypted, retention rules can't reach them, and destroying the document in the Vault doesn't affect them. The Shared copies log, and the count on the destruction receipt, record that they exist.
- **The viewer can't stop someone photographing the screen.** Screenshot protection, where the system supports it, only covers screenshots and screen sharing.
- **No passphrase and no recovery phrase means no access.** Nobody, including ImmuPact, can recover your vault.
- **Sepolia is a test network.** The network settings live in `src/core/standard.js` and will gain mainnet entries when ImmuPact moves.

## Roadmap

- Text selection and search inside the viewer.
- Mobile companion (read-only, with the same format and keys).
- Hardware-key unlock (WebAuthn / FIDO2).
- Encrypted sync between your own devices.
- Independent security audit.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
