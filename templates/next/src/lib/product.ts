// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The customer-facing product name. Rename your app here.
 *
 * It is a constant rather than an env var because it is needed in three places
 * that env vars serve badly: page metadata (read at build time), a client
 * component (a NEXT_PUBLIC_* would be inlined into the bundle and drift from
 * the server's value), and transactional email — where naming the product is
 * not decoration. A password-reset message that names no product, from no
 * identifiable sender, reads as phishing to the person deciding whether to
 * click it.
 *
 * In platform mode the platform sends recovery mail itself and titles it from
 * the app registry's displayName, so set that too when you rename — this
 * constant covers the standalone path and the UI.
 */
export const PRODUCT_NAME = "Evo App";
