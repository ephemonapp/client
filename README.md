# Ephemon

![Statements](.github/badges/coverage/badge-statements.svg) ![Lines](.github/badges/coverage/badge-lines.svg)
![Functions](.github/badges/coverage/badge-functions.svg) ![Branches](.github/badges/coverage/badge-branches.svg)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

End-to-end encrypted messenger — protocol, library and reference app. Messages go peer-to-peer over WebRTC; a server
only introduces peers and, with consent, sends a push. It holds no key that decrypts anything and keeps no history.
Anyone can run one, and people on different servers still reach each other.

|              |                                                                                       |
| ------------ | ------------------------------------------------------------------------------------- |
| Try it       | [ephemon.app](https://ephemon.app), installs as a PWA                                 |
| Run your own | [one interactive script](https://github.com/ephemonapp/server#readme), any Linux host |
| Build on it  | [`ephemon-core`](./packages/ephemon-core/) — the protocol alone, no UI                |

## Guarantees

- A signing key pair is your whole identity — no account, no registration. Encryption keys are separate, regenerated per
  connection.
- The server relays signed, time-limited signalling and nothing else; a TURN relay forwards ciphertext.
- Private messages carry no sender or recipient marks.
- History and keys never leave the device, encrypted under your password.
- Enforced by the protocol, not by promise — [coverage](https://ephemon.app/coverage) is public.

## Across instances

A contact code carries a public key and the server its owner is registered on. To reach a peer hosted elsewhere, the
initiator registers on that peer's server as a guest and signals the whole conversation through it. Guest registrations
carry no push subscription, so that server reaches the guest only while its connection lives. Each side's own server
travels inside the encrypted offer and answer, never in the dial that precedes the key exchange — which is what lets the
other side visit later.

## Features

Multiple conversations, replies, reactions, typing, delivery status, optional push. Two peer-to-peer channels per
conversation with relay fallback and live state. Contact codes by QR or text. Failures name the server and whether it is
down, refusing this app, or blocked as insecure. Any server from settings. PWA, themes, update notices.

## Development

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ephemonapp/client?quickstart=1)

An npm workspace: [`ephemon-app`](./packages/ephemon-app/) (React client) and [`ephemon-core`](./packages/ephemon-core/)
(protocol). In the dev container or a Codespace, `npm ci && npm run start` serves the app on `8081` against a server on
`5027`; `npm test` runs the core suite. [`docs/example.html`](docs/example.html) wires up every callback,
[Ephemon Proto.svg](<docs/Ephemon Proto.svg>) is the diagram. Next: group chats over MLS, voice messages, calls.

## License

[Apache-2.0](LICENSE)
