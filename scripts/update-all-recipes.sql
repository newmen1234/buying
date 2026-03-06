-- Update all 5 email recipes with comprehensive email type chains

-- 1. TradeInn (id=10) — processing, shipped, out_for_delivery, delivered
UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "tradeinn.com",
  "senderPatterns": ["news@tradeinn.com", "noreply@delivery.tradeinn.com"],
  "emailTypes": [
    {
      "type": "processing",
      "match": {
        "subjectContains": ["preparing your order"]
      },
      "impliedStatus": "processing",
      "extraction": {
        "orderIdPatterns": ["order\\s*(\\d{8,})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["has been shipped"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["order\\s*(\\d{8,})", "Bestellnummer\\s*(\\d{8,})"],
        "trackingPatterns": ["tracking=(H\\d{19,})", "tno=(H\\d{19,})", "tracking_number[=/](H\\d{19,})"],
        "carrierPatterns": ["(Spring GDS|DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "out_for_delivery",
      "match": {
        "subjectContains": ["ist zur Lieferung bereit", "zur Lieferung"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{8,})", "Bestellnummer\\s*(\\d{8,})"],
        "trackingPatterns": ["tracking=(H\\d{19,})", "tno=(H\\d{19,})"],
        "carrierPatterns": ["(Spring GDS|DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "delivery_confirmation",
      "match": {
        "subjectContains": ["wurde geliefert"]
      },
      "impliedStatus": "delivered",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{8,})", "Bestellnummer\\s*(\\d{8,})"],
        "trackingPatterns": ["tracking=(H\\d{19,})", "tno=(H\\d{19,})"],
        "carrierPatterns": ["(Spring GDS|DHL|Hermes|UPS|DPD|GLS)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"],
  "carrierAliases": {"Spring GDS": "Hermes"}
}'::jsonb, success_count = 0, fail_count = 0
WHERE id = 10;

-- 2. OutletCity (id=17) — shipping_confirmation, invoice
UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "outletcity.com",
  "senderPatterns": ["service@info.outletcity.com"],
  "emailTypes": [
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Versandbestätigung"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{8,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Ihre Rechnung zur Bestellung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(\\d{8,})"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE id = 17;

-- 3. BeautyWelt (id=18) — shipping, partial shipping, invoice, return
UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "beautywelt.de",
  "senderPatterns": ["info@beautywelt.de", "retouren@beautywelt.de"],
  "emailTypes": [
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Bestellung kommt in"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"],
        "trackingPatterns": ["Trackingnummer:\\s*(\\d{18,})", "idc=(\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "partial_shipment",
      "match": {
        "subjectContains": ["Teil deiner Bestellung ist auf dem Weg"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"],
        "trackingPatterns": ["Trackingnummer:\\s*(\\d{18,})", "idc=(\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS)"]
      }
    },
    {
      "type": "invoice",
      "match": {
        "subjectContains": ["Rechnung zu Deiner Bestellung"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnummer:\\s*(BW\\d+)"]
      }
    },
    {
      "type": "return_received",
      "match": {
        "subjectContains": ["Retoure zu Bestellung"]
      },
      "impliedStatus": "returned",
      "extraction": {
        "orderIdPatterns": ["Bestellung\\s*(BW\\d+)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE id = 18;

-- 4. Basler-Beauty (id=19) — order confirmation, shipping
UPDATE shop_recipes SET recipe_json = '{
  "version": 1,
  "shopName": "basler-beauty.de",
  "senderPatterns": ["service-team@basler-beauty.de"],
  "emailTypes": [
    {
      "type": "order_confirmation",
      "match": {
        "subjectContains": ["Vielen Dank"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Auftragsnummer\\s*(\\d+)"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Versandbest", "auf dem Weg"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "carrierPatterns": ["(Hermes|DHL|UPS|DPD|GLS)"],
        "orderIdPatterns": ["Auftragsnummer[:\\s]*(\\d+)"],
        "trackingPatterns": ["#([A-Z0-9]{18,})", "Sendungsnummer[:\\s]+(\\S+)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE id = 19;

-- 5. Notino (id=20) — order confirmed, payment confirmed, shipped
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
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellungsnummer lautet\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})"]
      }
    },
    {
      "type": "payment_confirmation",
      "match": {
        "subjectContains": ["Zahlungseingangs"]
      },
      "impliedStatus": "confirmed",
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})"]
      }
    },
    {
      "type": "shipping_confirmation",
      "match": {
        "subjectContains": ["Paket ist auf dem Weg"]
      },
      "impliedStatus": "shipped",
      "extraction": {
        "orderIdPatterns": ["Bestellnr\\.?\\s*(\\d+)", "Nr\\.?\\s*(\\d{9,})", "Bestellungsnummer\\s*(\\d+)"],
        "trackingPatterns": ["Sendungsnummer[:\\s]*(\\d{18,})", "(\\d{20})", "tracking[=/](\\d{18,})"],
        "carrierPatterns": ["(DHL|Hermes|UPS|DPD|GLS|Deutsche Post)"]
      }
    }
  ],
  "statusPriority": ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
}'::jsonb, success_count = 0, fail_count = 0
WHERE id = 20;
