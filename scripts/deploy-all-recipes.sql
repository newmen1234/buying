-- Batch 1: Email recipes for 7 shops
-- parfumgroup.de, massimodutti.com, hm.com, parfuemerie-cb.de, breuninger.com, zara.com, yoox.com

-- 1. parfumgroup.de — order confirmation + shipping (DHL tracking)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('parfumgroup.de', 'email_parsing', '{
  "version": 1,
  "shopName": "parfumgroup.de",
  "senderPatterns": ["info@parfumgroup.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["bestätigt"],
        "bodyContains": ["Vielen Dank für deinen Einkauf"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{7,})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["ist unterwegs"],
        "bodyContains": ["ist auf dem Weg"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{7,})"],
        "trackingPatterns": ["Trackingnummer[:\\s]*(\\d{20})"],
        "carrierPatterns": ["(DHL)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 2. massimodutti.com — order confirmation, shipping with tracking (HERMES), eReceipt shipped
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('massimodutti.com', 'email_parsing', '{
  "version": 1,
  "shopName": "massimodutti.com",
  "senderPatterns": ["noreply@massimodutti.com"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Confirmation of order No."],
        "bodyContains": ["we confirm that we have received your order"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["order No\\.\\s*(\\d{11})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["is on its way"],
        "bodyContains": ["left the warehouse with"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["order N[o.]?\\.?\\s*(\\d{11})"],
        "trackingPatterns": ["tracking number\\s+(H\\d{19,})"],
        "carrierPatterns": ["left the warehouse with\\s+(\\w+)"]
      }
    },
    {
      "type": "ereceipt_shipped",
      "match": {
        "subjectContains": ["eReceipt attached"],
        "bodyContains": ["Your order is on its way"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["order No\\.\\s*(\\d{11})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 3. hm.de (emails come from hm.com but CRM uses hm-de → hm.de)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('hm.de', 'email_parsing', '{
  "version": 1,
  "shopName": "hm.de",
  "senderPatterns": ["de@delivery.hm.com"],
  "emailTypes": [
    {
      "type": "purchase_receipt",
      "match": {
        "subjectContains": ["Dein Kaufbeleg"],
        "bodyContains": ["Einzelheiten zu deiner Bestellung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\s*(\\d{11})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Deine Bestellung wurde verschickt"],
        "bodyContains": ["deine Bestellung ist auf dem Weg"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\s*(\\d{11})"],
        "trackingPatterns": ["Sendungsnummer\\s*(\\d{20})"],
        "carrierPatterns": ["(DHL)"]
      }
    },
    {
      "type": "delivery_confirmation",
      "match": {
        "subjectContains": ["Deine Bestellung wurde zugestellt"],
        "bodyContains": ["dein Paket zugestellt wurde"]
      },
      "impliedStatus": "delivered",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\s*(\\d{11})"],
        "trackingPatterns": ["Sendungsnummer\\s*(\\d{20})"]
      }
    },
    {
      "type": "delay_update",
      "match": {
        "subjectContains": ["Update zur H&M-Bestellung", "verspätet", "verspatet"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\s*(\\d{11})", "H&M-Bestellung\\s*(\\d{11})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 4. parfuemerie-cb.de — order confirmation, shipping (no tracking), invoice, payment pending
-- Uses bodyContains to differentiate types B/C/D which share the same subject
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('parfuemerie-cb.de', 'email_parsing', '{
  "version": 1,
  "shopName": "parfuemerie-cb.de",
  "senderPatterns": ["noreply@parfuemerie-cb.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Bestellbestätigung"],
        "bodyContains": ["Bestellung ist bei uns angekommen"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d{5})"]
      }
    },
    {
      "type": "payment_pending",
      "match": {
        "subjectContains": ["Neues Dokument"],
        "bodyContains": ["nicht abgeschlossen"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d{5})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Neues Dokument"],
        "bodyContains": ["Lieferstatus: Versandt"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Number[:\\s]*(\\d{5})", "Nummer[:\\s]*(\\d{5})", "Bestellnummer[:\\s]*(\\d{5})"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Neues Dokument"],
        "bodyContains": ["Rechnung für Ihre Bestellung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Nummer[:\\s]*(\\d{5})", "Bestellnummer[:\\s]*(\\d{5})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 5. breuninger.com — order confirmation with delivery date, shipping with delivery date
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('breuninger.com', 'email_parsing', '{
  "version": 1,
  "shopName": "breuninger.com",
  "senderPatterns": ["no-reply@breuninger.com"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Vielen Dank für Ihre Bestellung"],
        "bodyContains": ["Bestellung ist unter der Nummer"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{9})", "Nummer\\s*(\\d{9})"],
        "deliveryDatePatterns": ["zwischen\\s*(\\d{2}\\.\\d{2}\\.\\d{2,4})\\s*und\\s*(\\d{2}\\.\\d{2}\\.\\d{2,4})", "voraussichtlich.*?(\\d{2}\\.\\d{2}\\.\\d{2,4})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Bald ist Ihre Bestellung da"],
        "bodyContains": ["ist bald da"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{9})"],
        "deliveryDatePatterns": ["Bestellung bis\\s*(\\d{2}\\.\\d{2}\\.\\d{2,4})"],
        "carrierPatterns": ["(DHL)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 6. zara.com — order confirmation, shipping DE/EN, in transit DE (no tracking)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('zara.com', 'email_parsing', '{
  "version": 1,
  "shopName": "zara.com",
  "senderPatterns": ["noreply@zara.com"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Thank you for your purchase"],
        "bodyContains": ["Order No."]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Order No\\.\\s*(\\d{11})"]
      }
    },
    {
      "type": "shipping_de",
      "match": {
        "subjectContains": ["Ihre Bestellung wurde versendet"],
        "bodyContains": ["Bestellung Nr."]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung Nr\\.\\s*(\\d{11})"]
      }
    },
    {
      "type": "shipping_en",
      "match": {
        "subjectContains": ["Your order has been shipped"],
        "bodyContains": ["ORDER NO."]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["ORDER NO\\.\\s*(\\d{11})"]
      }
    },
    {
      "type": "in_transit_de",
      "match": {
        "subjectContains": ["Ihre Bestellung ist unterwegs"],
        "bodyContains": ["Bestellung Nr."]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung Nr\\.\\s*(\\d{11})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 7. yoox.com — return received, return request, refund (multiple senders)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('yoox.de', 'email_parsing', '{
  "version": 1,
  "shopName": "yoox.de",
  "senderPatterns": ["returns@yoox.com", "myoox@emails.yoox.com"],
  "emailTypes": [
    {
      "type": "return_received",
      "match": {
        "fromExact": "returns@yoox.com",
        "subjectContains": ["Rucksendung erhalten"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["Nummer[:\\s]*(\\w{14})"],
        "trackingPatterns": ["Nummer\\s+(1Z\\w{16})"]
      }
    },
    {
      "type": "return_request",
      "match": {
        "fromExact": "myoox@emails.yoox.com",
        "subjectContains": ["ruckgabeantrag erhalten"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["BESTELLUNG Nummer[:\\s]*(\\w{14})"]
      }
    },
    {
      "type": "refund",
      "match": {
        "fromExact": "myoox@emails.yoox.com",
        "subjectContains": ["ruckerstattet"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["BESTELLUNG Nummer[:\\s]*(\\w{14})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "returned"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;
-- Batch 2: Email recipes for 5 shops
-- zalando.de, flaconi.de, tyresystem.de, aboutyou.de, parfimo.de

-- 1. zalando.de — order confirmation (DE+EN), shipping (delivery estimate), invoice, return, cancellation
-- Senders: info@service-mail.zalando.de (transactional), service@zalando.de (invoices/support)
-- Order ID format: 14-digit number like 10101690070521
-- Shipping emails have delivery date in subject but no tracking number in text
-- Both German (newmen) and English (vatebo) emails
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('zalando.de', 'email_parsing', '{
  "version": 1,
  "shopName": "zalando.de",
  "senderPatterns": ["info@service-mail.zalando.de", "service@zalando.de", "service@service-mail.zalando.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Danke für deine Bestellung", "Thanks for your order"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\n(\\d{14,17})", "Order number\\n(\\d{14,17})", "order-detail/(\\d{14,17})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Dein Paket wird", "Your parcel will"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\n(\\d{14,17})", "Order number\\n(\\d{14,17})", "order-detail/(\\d{14,17})"],
        "deliveryDatePatterns": ["(\\d{1,2}\\.\\d{2}\\.)\\s*(?:und|and)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Rechnung zu der Bestellung", "Invoice for order"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s+(\\d{14,17})", "order\\s+(\\d{14,17})"]
      }
    },
    {
      "type": "return_received",
      "match": {
        "subjectContains": ["Rücksendung an uns", "return"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer\\n(\\d{14,17})", "Order number\\n(\\d{14,17})", "order-detail/(\\d{14,17})"]
      }
    },
    {
      "type": "cancellation",
      "match": {
        "subjectContains": ["has been cancelled", "wurde storniert"]
      },
      "impliedStatus": "cancelled",
      "extraction": {
        "orderIdPatterns": ["Order number\\n(\\d{14,17})", "order-detail/(\\d{14,17})", "Bestellnummer\\n(\\d{14,17})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 2. flaconi.de — order confirmation, shipping (Hermes, no direct tracking), delivery, invoice
-- Senders: info@reply.flaconi.de (transactional), service@flaconi.de (reviews)
-- Order ID format: 1-647310819 (dash-separated)
-- Carrier: Hermes (mentioned in body but tracking via redirect links only)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('flaconi.de', 'email_parsing', '{
  "version": 1,
  "shopName": "flaconi.de",
  "senderPatterns": ["info@reply.flaconi.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Deine Bestellung vom"],
        "bodyContains": ["Bestellbestätigung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(\\d-\\d{9})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Bestellung wurde versandt"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(\\d-\\d{9})", "order-detail/(\\d-\\d{9})"],
        "carrierPatterns": ["an\\s+(Hermes)\\s+übergeben"]
      }
    },
    {
      "type": "delivery_confirmation",
      "match": {
        "subjectContains": ["Haustürzustellung", "zugestellt"]
      },
      "impliedStatus": "delivered",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(\\d-\\d{9})"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Deine Rechnung"],
        "bodyContains": ["Rechnung als PDF"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(\\d-\\d{9})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 3. tyresystem.de — order confirmation, shipping (DPD tracking), invoice
-- Sender: vertrieb@tyresystem.de
-- Order ID format: BT10236771 (BT prefix + digits) in subject
-- Tracking: DPD with 14-digit number, link to tracking.dpd.de
-- Invoice: RT prefix in subject
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('tyresystem.de', 'email_parsing', '{
  "version": 1,
  "shopName": "tyresystem.de",
  "senderPatterns": ["vertrieb@tyresystem.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Bestellbestätigung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["(BT\\d{7,8})", "Bestellnummer:\\s*(BT\\d{7,8})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Paketverfolgung"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["(BT\\d{7,8})"],
        "trackingPatterns": ["DPD:\\s*(?:<a[^>]*>)?(\\d{14,20})", "query=(\\d{14,20})"],
        "carrierPatterns": ["(DPD)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Rechnung RT"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Rechnung\\s+(RT\\d{7})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 4. aboutyou.de — SKIPPED: emails found are from aboutyou-outlet.de sender only
-- The correct recipe for aboutyou-outlet.de is in batch3.sql
-- aboutyou.de (main brand) needs separate email discovery

-- 5. parfimo.de — order confirmation, payment confirmation, payment request
-- Sender: info@parfimo.de
-- Order ID format: 5226788527 (10-digit number in subject and body)
-- Carrier: DHL (mentioned in order confirmation body)
-- No shipping confirmation emails found yet, only order + payment
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('parfimo.de', 'email_parsing', '{
  "version": 1,
  "shopName": "parfimo.de",
  "senderPatterns": ["info@parfimo.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Vielen Dank für die Bestellung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung(?:.*Nr\\.?)?\\s*(\\d{10})", "Bestellnummer[:\\s]*(\\d{10})"],
        "carrierPatterns": ["(DHL)"]
      }
    },
    {
      "type": "payment_confirmation",
      "match": {
        "subjectContains": ["wurde angenommen"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(?:Nr\\.?)?\\s*(\\d{10})", "Nummer\\s*(\\d{10})"]
      }
    },
    {
      "type": "payment_request",
      "match": {
        "subjectContains": ["Bitte Ihre Bestellung", "bezahlen"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(?:Nr\\.?)?\\s*(\\d{10})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered"]
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;
-- Batch 3: Email recipes for wardow.com, aponeo.de, decathlon.de, aboutyou-outlet.de, apondo.de
-- Generated from Fastmail email analysis

-- 1. wardow.com (vatebo, 19 emails found)
-- Senders: shop@wardow.com (order), news@reply.wardow.com (shipping), service@wardow.com (CS)
-- Order ID: 9 digits (e.g. 103611017)
-- Carrier: DHL, tracking: 20-digit DHL number
-- Shipping body has textBody with "Order No.\n103611017" and "via DHL" and 20-digit tracking
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('wardow.com', 'email_parsing', '{
  "version": 1,
  "shopName": "wardow.com",
  "senderPatterns": ["shop@wardow.com", "news@reply.wardow.com"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "fromExact": "shop@wardow.com",
        "subjectContains": ["Ihre Bestellung Nr."]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung Nr\\.\\s*(\\d{9})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "fromExact": "news@reply.wardow.com",
        "subjectContains": ["wurde versandt"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung Nr\\.\\s*(\\d{9})", "Order No\\.\\s*(\\d{9})"],
        "trackingPatterns": ["(\\d{20})"],
        "carrierPatterns": ["via\\s+(DHL|Hermes|UPS|DPD|GLS)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {}
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 2. aponeo.de (vatebo, 30 emails found)
-- Senders: no-reply@aponeo.de (order confirmation), no-reply@aponeo.de (shipping+invoice)
-- Also service@aponeo.de for refunds/returns but excluded from recipe
-- Order ID: 12-digit number (e.g. 159521575285)
-- Carrier: always DHL, tracking: 20-digit DHL number
-- Order confirmation subject: "Bestätigung - Bestelleingang Bestell-Nr: 159521575285"
-- Shipping subject: "Ihre Bestellung 159521575285 bei APONEO: Versandbestätigung & Rechnungsinformation"
-- Shipping body: "Sendungsnummer an: 00340434299059193485"
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('aponeo.de', 'email_parsing', '{
  "version": 1,
  "shopName": "aponeo.de",
  "senderPatterns": ["no-reply@aponeo.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Bestelleingang"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestell-Nr:\\s*(\\d{12})", "Bestellnummer:\\s*(\\d{12})", "Online-Bestellnummer:\\s*(\\d{12})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Versandbestätigung", "Versandbestatigung"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Ihre Bestellung\\s*(\\d{12})", "Bestell-Nr[.:]?\\s*(\\d{12})"],
        "trackingPatterns": ["Sendungsnummer\\s*(?:an:)?\\s*(\\d{20})", "idc=(\\d{20})"],
        "carrierPatterns": ["an\\s+(DHL|Hermes|UPS|DPD|GLS)\\s+(?:u|ü)bergeben", "(DHL|Hermes|UPS|DPD|GLS)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {}
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 3. decathlon.de (vatebo, 30 emails found)
-- Complex: 3 senders
--   noreply@services.decathlon.de: shipping ("Dein Paket ist unterwegs"), invoice, returns (all HTML-only)
--   noreply@tracking.partners.decathlon.de: delivery date updates (HTML-only)
--   service@decathlon.de: CS replies with order IDs and tracking in body
-- Order ID format: DE + alphanumeric (e.g. DE59HL7BYJUM, DE58METNCTP9, DE56624CVTMB)
-- Tracking: DHL, 12-digit (e.g. 143439808178) found in service@ emails
-- The noreply@ shipping emails are HTML-only with truncated textBody (CSS only), but the engine
-- will search htmlBody with tag stripping so they should still work for status detection
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('decathlon.de', 'email_parsing', '{
  "version": 1,
  "shopName": "decathlon.de",
  "senderPatterns": ["noreply@services.decathlon.de", "noreply@tracking.partners.decathlon.de", "service@decathlon.de"],
  "emailTypes": [
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Paket ist unterwegs"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(DE[A-Z0-9]{8,})", "(DE[A-Z0-9]{8,})"],
        "trackingPatterns": ["Sendungsnummer[:\\s]*(\\d{12,20})", "(\\d{12,20})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Deine Rechnung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(DE[A-Z0-9]{8,})", "(DE[A-Z0-9]{8,})"]
      }
    },
    {
      "type": "return_registered",
      "match": {
        "subjectContains": ["Retoure wurde im System hinterlegt"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(DE[A-Z0-9]{8,})", "(DE[A-Z0-9]{8,})"]
      }
    },
    {
      "type": "delivery_date_update",
      "match": {
        "subjectContains": ["Aktualisiertes Lieferdatum"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(DE[A-Z0-9]{8,})", "(DE[A-Z0-9]{8,})"],
        "deliveryDatePatterns": ["(\\d{1,2}\\.\\d{1,2}\\.\\d{4})"]
      }
    },
    {
      "type": "service_message",
      "match": {
        "fromExact": "service@decathlon.de",
        "subjectContains": ["Mitteilung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(DE[A-Z0-9]{8,})"],
        "trackingPatterns": ["Sendungsnummer[:\\s]*(\\d{12,20})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {}
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 4. aboutyou-outlet.de (vatebo, 30 emails found)
-- Sender: noreply@aboutyou-outlet.de (all emails)
-- Order ID: aode-5200-XXXXXXXXX (e.g. aode-5200-368166259)
-- Email types by subject:
--   "ABOUT YOU OUTLET [DE] - Bestelleingangsbestätigung: aode-5200-368166259" (order confirmation)
--   "ABOUT YOU OUTLET [DE]  - Sendungsverfolgung: aode-5200-367919691" (shipping, note double space)
--   "ABOUT YOU OUTLET [DE] - Rechnung: aode-5200-367938434" (invoice)
-- Body: HTML-only (textBody is raw HTML/CSS), need htmlBody parsing
-- Tracking/carrier info likely in HTML body but not visible in truncated samples
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('aboutyou-outlet.de', 'email_parsing', '{
  "version": 1,
  "shopName": "aboutyou-outlet.de",
  "senderPatterns": ["noreply@aboutyou-outlet.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Bestelleingangsbestätigung", "Bestelleingangsbestatigung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["(aode-\\d+-\\d+)"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Sendungsverfolgung"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["(aode-\\d+-\\d+)"],
        "trackingPatterns": ["(\\d{14,20})", "(H\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Rechnung:"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["(aode-\\d+-\\d+)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {}
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;

-- 5. apondo.de (vatebo, 13 emails found)
-- Senders: info@apondo.de (order confirmation), versand@info.apondo.de (shipping)
-- Order ID: 8-digit number (e.g. 67176717, 67172512)
-- Carrier: always DHL
-- Tracking: 20-digit DHL number (e.g. 00340434465258963116)
-- Order confirmation: subject "Bestellbestätigung", body has "Shop-Bestellnummer (Order-ID) lautet: 67176717"
-- Shipping: subject "Ihre Bestellung wurde verschickt", from versand@info.apondo.de
--   body: "per DHL mit folgenden Daten versendet" + "Ihre Paketnr. lautet 00340434465258963116"
-- NOTE: Shipping emails do NOT contain order ID (Belegnummer is empty)
INSERT INTO shop_recipes (domain, login_type, recipe_json, success_count, fail_count)
VALUES ('apondo.de', 'email_parsing', '{
  "version": 1,
  "shopName": "apondo.de",
  "senderPatterns": ["info@apondo.de", "versand@info.apondo.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "fromExact": "info@apondo.de",
        "subjectContains": ["Bestellbestätigung", "Bestellbestatigung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Shop-Bestellnummer\\s*\\(Order-ID\\)\\s*lautet:\\s*(\\d{8})", "Order-ID[):\\s]*(\\d{8})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "fromExact": "versand@info.apondo.de",
        "subjectContains": ["wurde verschickt"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "trackingPatterns": ["Paketnr\\.\\s*lautet\\s*(\\d{20})", "idc=(\\d{20})", "(\\d{20})"],
        "carrierPatterns": ["per\\s+(DHL|Hermes|UPS|DPD|GLS)", "Versandart:\\s*(DHL|Hermes|UPS|DPD|GLS)", "(DHL|Hermes|UPS|DPD|GLS)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {}
}'::jsonb, 0, 0)
ON CONFLICT (domain, login_type) DO UPDATE SET recipe_json = EXCLUDED.recipe_json, success_count = 0, fail_count = 0;
-- Fix broken email recipes
-- Generated: 2026-03-01
-- Fixes for: beautywelt.de, notino.de, outletcity.com

-- ============================================================
-- 1. BEAUTYWELT.DE
-- Problem: Missing order_confirmation type (subject "Vielen Dank für deine Bestellung BW...")
-- Also missing cancellation type (subject "Widerruf - Storno zu Auftrag BW...")
-- Result: 0/21 success because most found emails are order confirmations that don't match any rule
-- Fix: Add order_confirmation and cancellation email types
-- ============================================================

UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "beautywelt.de",
  "senderPatterns": ["info@beautywelt.de", "retouren@beautywelt.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Vielen Dank für deine Bestellung"]
      },
      "extraction": {
        "orderIdPatterns": ["(BW\\d+)"]
      },
      "impliedStatus": "confirmed"
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Bestellung kommt in"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"],
        "trackingPatterns": ["Trackingnummer:\\s*(\\d{18,})", "idc=(\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      },
      "impliedStatus": "shipped"
    },
    {
      "type": "partial_shipment",
      "match": {
        "subjectContains": ["Teil deiner Bestellung ist auf dem Weg"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"],
        "trackingPatterns": ["Trackingnummer:\\s*(\\d{18,})", "idc=(\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      },
      "impliedStatus": "shipped"
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Rechnung zu Deiner Bestellung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"]
      },
      "impliedStatus": "confirmed"
    },
    {
      "type": "return_received",
      "match": {
        "subjectContains": ["Retoure zu Bestellung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(BW\\d+)"]
      },
      "impliedStatus": "returned"
    },
    {
      "type": "cancellation",
      "match": {
        "subjectContains": ["Widerruf - Storno"]
      },
      "extraction": {
        "orderIdPatterns": ["Auftrag:\\s*(BW\\d+)", "(BW\\d+)"]
      },
      "impliedStatus": "cancelled"
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE domain = 'beautywelt.de' AND login_type = 'email_parsing';


-- ============================================================
-- 2. NOTINO.DE
-- Problem: Most failures are emailsAnalyzed=0 (legalEntity mismatch or timing).
-- The 6 successes show the recipe works when emails are found.
-- Fix: Add missing return/refund types, keep everything else.
-- Note: textBody contains raw HTML but subjectContains matching works on subject field,
-- and extraction uses fullText (textBody + subject + stripped htmlBody) so orderId
-- in subject "Bestellnr. 423784916" is captured by existing patterns.
-- ============================================================

UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "notino.de",
  "senderPatterns": ["no-reply@notino.de", "info@notino.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["ist bei uns eingegangen"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellungsnummer lautet\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})"]
      },
      "impliedStatus": "confirmed"
    },
    {
      "type": "payment_confirmation",
      "match": {
        "subjectContains": ["Zahlungseingangs"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})"]
      },
      "impliedStatus": "confirmed"
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Paket ist auf dem Weg"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})", "Bestellungsnummer\\s*(\\d+)"],
        "trackingPatterns": ["Sendungsnummer[:\\s]*(\\d{18,})", "(\\d{20})", "tracking[=/](\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS|Deutsche Post)"]
      },
      "impliedStatus": "shipped"
    },
    {
      "type": "refund",
      "match": {
        "subjectContains": ["Rückzahlung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})"]
      },
      "impliedStatus": "returned"
    },
    {
      "type": "return_reversal",
      "match": {
        "subjectContains": ["Widerruf"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})", "R\\d+"]
      },
      "impliedStatus": "returned"
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE domain = 'notino.de' AND login_type = 'email_parsing';


-- ============================================================
-- 3. OUTLETCITY.COM
-- Problem 1: Wrong sender - recipe has "service@info.outletcity.com" but actual is "service@mail.outletcity.com"
-- Problem 2: Missing order_confirmation type (subject "Vielen Dank für Ihre Bestellung bei OUTLETCITY.COM!")
-- Problem 3: orderIdPattern "Bestellung\\s*(\\d{8,})" doesn't match "Bestellnummer: 49763298"
-- Fix: Correct sender, add order_confirmation, fix orderIdPattern
-- ============================================================

UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "outletcity.com",
  "senderPatterns": ["service@mail.outletcity.com"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Vielen Dank für Ihre Bestellung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d{8,})"]
      },
      "impliedStatus": "confirmed"
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Versandbestätigung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d{8,})", "Bestellung\\s*(\\d{8,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      },
      "impliedStatus": "shipped"
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Ihre Rechnung zur Bestellung"]
      },
      "extraction": {
        "orderIdPatterns": ["Bestellnummer[:\\s]*(\\d{8,})", "Bestellung\\s*(\\d{8,})"]
      },
      "impliedStatus": "confirmed"
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE domain = 'outletcity.com' AND login_type = 'email_parsing';
