# Security policy

## Reporting a vulnerability

Please **don't** open a public issue for security problems. Use GitHub's private vulnerability reporting instead (**Security → Report a vulnerability** on this repository). We aim to reply within 5 working days.

Please include:
- what you found
- how to reproduce it
- which version or commit you tested

## Scope

Reports we especially want:
- anything that reveals a document, a file name or a key without the passphrase or recovery phrase
- anything that lets a destroyed document be read back from the vault folder after destruction
- a forged destruction receipt that verifies
- a file reported as **Anchored** when it isn't the anchored file
- escaping the Electron sandbox from document content

Out of scope:
- attacks that need malware already running as the user while the vault is unlocked
- copies kept outside the vault
- backups made before a destruction

These limits are documented in the README.

## Never share your keys

Nobody working on this project will ever ask for your passphrase, your recovery phrase or a wallet private key. Treat anyone who does as an attacker.
