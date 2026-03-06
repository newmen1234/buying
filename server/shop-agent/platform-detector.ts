/**
 * Detect the e-commerce platform of a shop by analysing HTML + URL patterns.
 * Returns a platform identifier and a set of well-known URL paths.
 */

export type ShopPlatform =
  | "jtl"
  | "shopware5"
  | "shopware6"
  | "magento"
  | "woocommerce"
  | "shopify"
  | "prestashop"
  | "oxid"
  | "unknown";

export interface PlatformInfo {
  platform: ShopPlatform;
  confidence: number; // 0-1
  loginUrl: string | null;
  ordersUrl: string | null;
  /** CSS selectors or known URL templates */
  hints: PlatformHints;
}

export interface PlatformHints {
  loginFormSelector?: string;
  emailField?: string;
  passwordField?: string;
  loginButton?: string;
  ordersPageUrl?: string;
  orderRowSelector?: string;
  orderIdSelector?: string;
  orderStatusSelector?: string;
  trackingSelector?: string;
  cookieBannerSelector?: string;
  /** Extra tips for AI */
  navigationTips?: string[];
}

interface DetectionRule {
  platform: ShopPlatform;
  /** Check HTML source  */
  htmlPatterns: RegExp[];
  /** Check URL patterns (current or known) */
  urlPatterns?: RegExp[];
  /** Score weight per match (0-1) */
  weight: number;
  hints: PlatformHints;
  /** Known login path relative to domain */
  loginPath: string;
  /** Known orders path relative to domain */
  ordersPath: string;
}

const RULES: DetectionRule[] = [
  // ─── JTL-Shop 4/5 ─────────────────────────────────────────────
  {
    platform: "jtl",
    htmlPatterns: [
      /jtl[-_]?shop/i,
      /jtl\.php/i,
      /JTL_TOKEN/i,
      /jtl-token/i,
      /class="jtl/i,
      /\/media\/image\/product\//i,
      /name="jtl_token"/i,
    ],
    urlPatterns: [/jtl\.php/i, /\/registrieren$/i],
    weight: 0.2,
    loginPath: "/Mein-Konto-anmelden",
    ordersPath: "/jtl.php?bestellungen=1",
    hints: {
      loginFormSelector: "form#jtl_php_login, form[action*='jtl.php']:has(input[type='password'])",
      emailField: "form#jtl_php_login input[name='bwadr'], form#jtl_php_login input[type='email']",
      passwordField: "form#jtl_php_login input[name='bwagp'], form#jtl_php_login input[type='password']",
      loginButton: "form#jtl_php_login",
      ordersPageUrl: "/jtl.php?bestellungen=1",
      cookieBannerSelector: ".consent-banner button, .cookie-consent button, #consent-banner button, #usercentrics-root",
      navigationTips: [
        "JTL Shop: login at /Mein-Konto-anmelden, orders at /jtl.php?bestellungen=1",
        "IMPORTANT: JTL login pages often have BOTH a login form AND a registration form. The login form has id='jtl_php_login'. ALWAYS use 'form#jtl_php_login' prefix for selectors to target the login form, not registration!",
        "JTL field names are obfuscated: email field is 'bwadr', password field is 'bwagp'. Use form#jtl_php_login input[name='bwadr'] and form#jtl_php_login input[name='bwagp']",
        "CRITICAL: After filling credentials, DO NOT click the submit button — use form_submit action with selector 'form#jtl_php_login' to submit the form via JavaScript. Click often fails due to overlays.",
        "After login, navigate directly to /jtl.php?bestellungen=1 for order history (NOT /mein-konto/bestellungen which returns 404)",
      ],
    },
  },

  // ─── Shopware 5 ────────────────────────────────────────────────
  {
    platform: "shopware5",
    htmlPatterns: [
      /shopware/i,
      /class="shopware/i,
      /\/engine\/Shopware/i,
      /sw-csrf-token/i,
      /themes\/Frontend\/Responsive/i,
      /__csrf_token/i,
    ],
    urlPatterns: [/\/account$/i, /\/account\/login$/i],
    weight: 0.2,
    loginPath: "/account/login",
    ordersPath: "/account/orders",
    hints: {
      loginFormSelector: "form.register--login, form[action*='account/login']",
      emailField: "input[name='email'], input#email",
      passwordField: "input[name='password'], input#passwort",
      loginButton: "button.register--login-btn, button[type='submit']",
      ordersPageUrl: "/account/orders",
      cookieBannerSelector: ".cookie-permission--container button, .cookie--notice button",
      navigationTips: [
        "Shopware 5: login at /account/login, orders at /account/orders",
        "CSRF token is automatically handled — just fill & submit the login form",
      ],
    },
  },

  // ─── Shopware 6 ────────────────────────────────────────────────
  {
    platform: "shopware6",
    htmlPatterns: [
      /shopware-6/i,
      /sw-cms/i,
      /\/bundles\/Storefront/i,
      /data-csrf-mode/i,
      /StorefrontBundle/i,
      /sw-offcanvas/i,
    ],
    weight: 0.2,
    loginPath: "/account/login",
    ordersPath: "/account/order",
    hints: {
      loginFormSelector: "form[action*='account/login']",
      emailField: "input[name='email'], input#loginMail",
      passwordField: "input[name='password'], input#loginPassword",
      loginButton: "button.login-submit, button[type='submit']",
      ordersPageUrl: "/account/order",
      cookieBannerSelector: ".cookie-permission-container button, .js-cookie-accept-all-button",
      navigationTips: [
        "Shopware 6: login at /account/login, orders at /account/order",
        "Cookie accept button often has class .js-cookie-accept-all-button",
      ],
    },
  },

  // ─── Magento 1/2 ───────────────────────────────────────────────
  {
    platform: "magento",
    htmlPatterns: [
      /Magento/i,
      /Mage\.Cookies/i,
      /\/static\/frontend\//i,
      /form_key/i,
      /mage\/cookies/i,
      /require\.js/i,
      /\/mage\/requirejs/i,
      /catalog-search/i,
    ],
    urlPatterns: [/\/customer\/account/i, /\/checkout\/cart/i],
    weight: 0.2,
    loginPath: "/customer/account/login",
    ordersPath: "/sales/order/history",
    hints: {
      loginFormSelector: "form#login-form, form[action*='customer/account/loginPost']",
      emailField: "input#email, input[name='login[username]']",
      passwordField: "input#pass, input[name='login[password]']",
      loginButton: "button#send2, button.login, button[type='submit']",
      ordersPageUrl: "/sales/order/history",
      orderRowSelector: ".order-products-toolbar .order, table.orders-history tbody tr",
      cookieBannerSelector: ".cookie-status-message button, #cookie-notice button, .cc-btn",
      navigationTips: [
        "Magento: login at /customer/account/login, orders at /sales/order/history",
        "Login form uses name='login[username]' and name='login[password]'",
      ],
    },
  },

  // ─── WooCommerce ───────────────────────────────────────────────
  {
    platform: "woocommerce",
    htmlPatterns: [
      /woocommerce/i,
      /wc-block/i,
      /wp-content\/plugins\/woocommerce/i,
      /class="woocommerce/i,
      /wc_add_to_cart/i,
    ],
    urlPatterns: [/\/my-account/i, /\/mein-konto/i],
    weight: 0.2,
    loginPath: "/my-account",
    ordersPath: "/my-account/orders",
    hints: {
      loginFormSelector: "form.woocommerce-form-login, form.login",
      emailField: "input#username, input[name='username']",
      passwordField: "input#password, input[name='password']",
      loginButton: "button.woocommerce-form-login__submit, button[name='login']",
      ordersPageUrl: "/my-account/orders",
      orderRowSelector: "table.woocommerce-orders-table tbody tr",
      orderIdSelector: "td.woocommerce-orders-table__cell-order-number",
      orderStatusSelector: "td.woocommerce-orders-table__cell-order-status",
      cookieBannerSelector: ".cookie-notice button, #cookie-law-info-bar button, .cmplz-btn",
      navigationTips: [
        "WooCommerce: login at /my-account (or /mein-konto for DE), orders at /my-account/orders",
        "Login may use 'username' field instead of 'email'",
        "German WooCommerce may have /mein-konto instead of /my-account",
      ],
    },
  },

  // ─── Shopify ───────────────────────────────────────────────────
  {
    platform: "shopify",
    htmlPatterns: [
      /Shopify\.theme/i,
      /cdn\.shopify\.com/i,
      /shopify-section/i,
      /myshopify\.com/i,
      /\/\/cdn\.shopify/i,
    ],
    urlPatterns: [/\/account$/i, /myshopify\.com/i],
    weight: 0.2,
    loginPath: "/account/login",
    ordersPath: "/account",
    hints: {
      loginFormSelector: "form[action*='account/login'], #customer_login",
      emailField: "input[name='customer[email]'], input#CustomerEmail",
      passwordField: "input[name='customer[password]'], input#CustomerPassword",
      loginButton: "button[type='submit'], input[type='submit']",
      ordersPageUrl: "/account",
      cookieBannerSelector: ".cookie-banner button, .shopify-section-cookies button",
      navigationTips: [
        "Shopify: login at /account/login, orders shown at /account",
        "Shopify email field is name='customer[email]', password is name='customer[password]'",
      ],
    },
  },

  // ─── PrestaShop ────────────────────────────────────────────────
  {
    platform: "prestashop",
    htmlPatterns: [
      /prestashop/i,
      /PrestaShop/,
      /\/modules\/ps_/i,
      /id_lang/i,
      /prestashop-core/i,
    ],
    weight: 0.2,
    loginPath: "/mein-konto",
    ordersPath: "/bestellungsverlauf",
    hints: {
      loginFormSelector: "form#login-form, form[action*='login']",
      emailField: "input[name='email'], input#field-email",
      passwordField: "input[name='password'], input#field-password",
      loginButton: "button#submit-login, button[type='submit']",
      ordersPageUrl: "/bestellungsverlauf",
      cookieBannerSelector: ".cookie_consent button, .eu-cookie-compliance-banner button",
      navigationTips: [
        "PrestaShop: login at /mein-konto (DE) or /my-account, orders at /bestellungsverlauf or /order-history",
      ],
    },
  },

  // ─── OXID eShop ────────────────────────────────────────────────
  {
    platform: "oxid",
    htmlPatterns: [
      /OXID/i,
      /oxid-esale/i,
      /cl=account/i,
      /fnc=login/i,
      /oxideshop/i,
    ],
    urlPatterns: [/cl=account/i],
    weight: 0.2,
    loginPath: "/mein-konto/",
    ordersPath: "/mein-konto/meine-bestellungen/",
    hints: {
      loginFormSelector: "form[name='login'], form.loginBox form",
      emailField: "input[name='lgn_usr']",
      passwordField: "input[name='lgn_pwd']",
      loginButton: "button.submitButton, button[type='submit']",
      ordersPageUrl: "/mein-konto/meine-bestellungen/",
      cookieBannerSelector: ".cookie-note button, .cc-btn",
      navigationTips: [
        "OXID: login field names are lgn_usr / lgn_pwd",
        "Login at /mein-konto/, orders at /mein-konto/meine-bestellungen/",
      ],
    },
  },
];

/**
 * Detect the shop platform from raw HTML + URL.
 * Returns platform info with confidence score and navigation hints.
 */
export function detectPlatform(html: string, url: string): PlatformInfo {
  const scores = new Map<ShopPlatform, number>();

  for (const rule of RULES) {
    let matchCount = 0;

    for (const pattern of rule.htmlPatterns) {
      if (pattern.test(html)) matchCount++;
    }

    if (rule.urlPatterns) {
      for (const pattern of rule.urlPatterns) {
        if (pattern.test(url) || pattern.test(html)) matchCount++;
      }
    }

    const totalPatterns = rule.htmlPatterns.length + (rule.urlPatterns?.length || 0);
    const score = (matchCount / totalPatterns) * rule.weight + (matchCount > 0 ? 0.3 : 0);

    if (matchCount > 0) {
      scores.set(rule.platform, Math.min(1, score + (scores.get(rule.platform) || 0)));
    }
  }

  // Find best match
  let bestPlatform: ShopPlatform = "unknown";
  let bestScore = 0;

  for (const [platform, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestPlatform = platform;
    }
  }

  // Need at least 0.25 confidence
  if (bestScore < 0.25) {
    return {
      platform: "unknown",
      confidence: 0,
      loginUrl: null,
      ordersUrl: null,
      hints: {},
    };
  }

  const rule = RULES.find((r) => r.platform === bestPlatform)!;
  const baseUrl = new URL(url).origin;

  return {
    platform: bestPlatform,
    confidence: Math.round(bestScore * 100) / 100,
    loginUrl: `${baseUrl}${rule.loginPath}`,
    ordersUrl: `${baseUrl}${rule.ordersPath}`,
    hints: rule.hints,
  };
}

/**
 * Build a concise platform context string for the AI model.
 * Includes known selectors, URLs, and tips.
 */
export function buildPlatformContext(info: PlatformInfo): string {
  if (info.platform === "unknown") return "";

  const lines: string[] = [
    `DETECTED PLATFORM: ${info.platform} (confidence: ${Math.round(info.confidence * 100)}%)`,
  ];

  if (info.loginUrl) lines.push(`Login URL: ${info.loginUrl}`);
  if (info.ordersUrl) lines.push(`Orders URL: ${info.ordersUrl}`);

  const h = info.hints;
  if (h.emailField) lines.push(`Email field: ${h.emailField}`);
  if (h.passwordField) lines.push(`Password field: ${h.passwordField}`);
  if (h.loginButton) lines.push(`Login button: ${h.loginButton}`);
  if (h.loginFormSelector) lines.push(`Login form: ${h.loginFormSelector}`);
  if (h.cookieBannerSelector) lines.push(`Cookie banner: ${h.cookieBannerSelector}`);
  if (h.orderRowSelector) lines.push(`Order row: ${h.orderRowSelector}`);
  if (h.orderIdSelector) lines.push(`Order ID cell: ${h.orderIdSelector}`);
  if (h.orderStatusSelector) lines.push(`Order status cell: ${h.orderStatusSelector}`);

  if (h.navigationTips && h.navigationTips.length > 0) {
    lines.push("");
    lines.push("PLATFORM TIPS:");
    for (const tip of h.navigationTips) {
      lines.push(`• ${tip}`);
    }
  }

  return lines.join("\n");
}
