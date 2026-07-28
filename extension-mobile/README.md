# Sharely Orion mobile extension

This is a separate WebExtension build for Orion on iOS/iPadOS. The existing
`extension/` Chrome build is not modified by this target.

## Compatibility position

Orion documents that iOS/iPadOS support is limited by Apple/WebKit and points
developers to its official WebExtension API support matrix. This build
therefore checks `cookies`, `storage`, and `tabs` at runtime. It never reports
cookie injection as successful unless the browser returns a cookie object and
the follow-up read sees the cookie.

If Orion does not expose or permit the required cookie operation, the UI
displays:

> Orion does not support this Sharely feature on iOS.

No workaround attempts to bypass WebKit's cookie security model.

## Build / install

This target has no bundler or package dependencies. Zip the contents of this
directory (not the directory itself), then install the resulting WebExtension
using Orion's extension installation flow. Orion's iOS extension installation
and third-party-extension settings are controlled by Orion; use its current
official iOS extension documentation for the exact device steps.

The mobile manifest intentionally omits icons until real PNG assets are added;
the desktop code and manifest are not shared.

## Test mode

Open the popup and choose **Run Orion capability test**. It uses only
`https://example.com` and a temporary cookie named `sharely_orion_test`. It
checks API presence, `cookies.set`, `cookies.getAll`, and `cookies.remove`.
It does not use a Sharely account or send any cookie value to a server.

The Sharely flow requires:

1. Authenticated Sharely membership session.
2. Service configuration from Railway using the member access token.
3. Supported `cookies.set` calls.
4. Opening the target site.

The final step is only marked successful when all cookie writes succeed.